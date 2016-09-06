'use strict';
var fs = require('fs');
var path = require('path');
var util = require('util');
var md5 = require('md5');
var async = require('async');

var packages   = require('./packages')
  , fieldsUtil = require('./fields')
  , IndentedWriter = require('./IndentedWriter.js');

const Field = fieldsUtil.Field;

var messages = exports;

function getFullMessageName(packageName, messageName) {
  return packageName + '/' + messageName;
}

// ---------------------------------------------------------
// exported functions

/** get message handler class from registry */
messages.getFromRegistry = function(messageType, type) {
  return getMessageFromRegistry(messageType, type);
};

messages.getPackageFromRegistry = function(packagename) {
  return registry[packagename];
};

/** ensure the handler for this message type is in the registry,
 * create it if it doesn't exist */
messages.getMessage = function(messageType, callback) {
  getMessageFromPackage(messageType, "msg", callback);
}

/** ensure the handler for requests for this service type is in the
 * registry, create it if it doesn't exist */
messages.getService = function(messageType, callback) {
  getMessageFromPackage(messageType, "srv", callback);
}

// ---------------------------------------------------------
// Registry

var registry = {};
/*
   registry looks like:
  { 'packagename':
    {
      msg: {
        'String': classdef,
        'Pose': classdef,
        ...
      },
      srv: { Request:
             {
               'SetBool': classdef,
               ...
             },
             Response:
             {
               'SetBool': classdef,
               ...
             }
           }
    },
    'packagename2': {..}
  };
*/

/**
   @param messageType is the ROS message or service type, e.g.
   'std_msgs/String'
   @param type is from the set
   [["msg"], ["srv","Request"], ["srv","Response"]
*/
function getMessageFromRegistry(messageType, type) {
  var packageName = getPackageNameFromMessageType(messageType);
  var messageName = getMessageNameFromMessageType(messageType);
  var packageSection = registry[packageName];
  if (!packageSection) {
    return undefined;
  }
  var section = registry[packageName][type[0]]; // msg or srv sub-object
  if (!section) {
    return undefined;
  }
  if (type.length == 1) {
    // message
    return section[messageName];
  } else {
    // service
    if (!section[messageName]) {
      return undefined;
    }
    return section[messageName][type[1]];
  }
}

/**
    @param messageType is the ROS message or service type, e.g.
    'std_msgs/String'
    @param message is the message class definition
    @param type is from the set "msg", "srv"
    @param (optional) subtype \in { "Request", "Response" }
*/
function setMessageInRegistry(messageType, message, type, subtype) {

  var packageName = getPackageNameFromMessageType(messageType);
  var messageName = getMessageNameFromMessageType(messageType);

  if (!registry[packageName]) {
    registry[packageName] = { msg: {}, srv: {}};
  }

  if (type == "msg") {
    // message
    registry[packageName][type][messageName] = message;
  } else {
    // service
    if (!registry[packageName][type][messageName]) {
      registry[packageName][type][messageName] = {};
    }

    var serviceType = type[1]; // "Request" or "Response"
    registry[packageName][kind][messageName][serviceType] = message;
  }
}


// ---------------------------------------------------------
// private functions

/* get message or service definition class */
function getMessageFromPackage(messageType, type, callback) {
  var packageName = getPackageNameFromMessageType(messageType);
  var messageName = getMessageNameFromMessageType(messageType);
  packages.findPackage(packageName, function(error, directory) {
    var filePath;
    filePath = path.join(directory, type, messageName + '.' + type);
    getMessageFromFile(messageType, filePath, type, callback);
  });
}

function buildMessageSpec(packageName, messageName, filePath, type) {
  const details = {
    messageType: getFullMessageName(packageName, messageName),
    messageName: messageName,
    packageName: packageName
  };

  parseMessageFile(filePath, details, type);
  return details;
}

function getMessageFromFile(messageType, filePath, type) {
  var packageName = getPackageNameFromMessageType(messageType)
  , messageName = getMessageNameFromMessageType(messageType);

  var details = {
    messageType : messageType
    , messageName : messageName
    , packageName : packageName
  };

  parseMessageFile(filePath, details, type);
  if (type[0] === 'msg') {
    buildMessageClass(details);
  }
}

function parseMessageFile(fileName, details, type) {
  details = details || {};
  let content = fs.readFileSync(fileName, 'utf8');
  let info = extractFields(content, details, type);
  details.type      = type[0];
  details.constants = info.constants;
  details.fields    = info.fields;
  return details;
};

// -------------------------------
// functions relating to handler class


function calculateMD5(details) {
  var message = '';

  function getMD5text(part) {
    var constants = part.constants.map(function(field) {
      return field.type + ' ' + field.name + '=' + field.value;
    }).join('\n');

    var fields = part.fields.map(function(field) {
      if (field.isBuiltin) {
        return field.type + ' ' + field.name;
      }
      else {
        return field.messageType.md5 + ' ' + field.name;
      }
    }).join('\n');

    message += constants;
    if (message.length > 0 && fields.length > 0) {
      message += "\n";
    }
    message += fields;
    return message;
  }

  // depending on type, compose the right md5text to compute md5sum
  // over: Services just concatenate the individual message text (with
  // *no* new line in between)
  var text;
  const type = details.type;
  if (type == "msg") {
    text = getMD5text(details);
  } else if (type == "srv") {
    text = getMD5text(details.request);
    text += getMD5text(details.response);
  } else {
    console.log("calculateMD5: Unknown type", type);
    return null;
  }

  return md5(text);
}

function extractFields(content, details, type) {
  var constants = []
    , fields    = []
    ;

  var parseLine = function(line) {
    line = line.trim();

      var lineEqualIndex   = line.indexOf('=')
      , lineCommentIndex = line.indexOf('#')
      ;
      if (lineEqualIndex === -1
          || lineCommentIndex=== -1
          || lineEqualIndex>= lineCommentIndex)
      {
        line = line.replace(/#.*/, '');
      }

    if (line !== '') {
      var firstSpace = line.indexOf(' ')
        , fieldType  = line.substring(0, firstSpace)
        , field      = line.substring(firstSpace + 1)
        , equalIndex = field.indexOf('=')
        , fieldName  = field.trim()
        ;

      if (equalIndex !== -1) {
        fieldName = field.substring(0, equalIndex).trim();
        var constant = field.substring(equalIndex + 1, field.length).trim();
        var parsedConstant = fieldsUtil.parsePrimitive(fieldType, constant);

        constants.push({
          name        : fieldName
        , type        : fieldType
        , value       : parsedConstant
        , index       : fields.length
        , messageType : null
        });
      }
      else {
        let f = new Field(fieldName.trim(), fieldType);
        fields.push(f);
      }
    }
  };


  var lines = content.split('\n').map((line) => line.trim());
  if (type[0] != "msg") {
    var divider = lines.indexOf("---");
    if (type[1] == "Request") {
      lines = lines.slice(0, divider);
    } else {
      // response
      lines = lines.slice(divider+1);
    }
  }

  lines.forEach(parseLine);
  return {
    constants: constants,
    fields: fields
  };
};

function camelCase(underscoreWord, lowerCaseFirstLetter) {
  var camelCaseWord = underscoreWord.split('_').map(function(word) {
    return word[0].toUpperCase() + word.slice(1);
  }).join('');

  if (lowerCaseFirstLetter) {
    camelCaseWord = camelCaseWord[0].toLowerCase() + camelCaseWord.slice(1)
  }

  return camelCaseWord;
}

function getMessageDependencies(details) {
  let deps = [];
  details.fields.forEach((field) => {
    if (!field.isBuiltin) {
      deps.push(field);
    }
  });
  return deps;
}

function writeHeader(w, details) {
  w.dividingLine();
  w.write('// Auto-generated from package %s.', details.packageName);
  w.write('// !! Do not edit !!');
  w.dividingLine();
  w.newline();
}

function writeRequires(w, details, isSrv) {
  w.write('"use strict";');
  w.newline();
  w.write('const _ros_msg_utils = require(\'ros_msg_utils\');');
  w.write('const _serializer = _ros_msg_utils.Serialize;');
  w.write('const _deserializer = _ros_msg_utils.Deserialize;');
  w.write('const _finder = _ros_msg_utils.Find;');
  let deps = getMessageDependencies(details);
  const packageName = details.packageName;
  deps.forEach((dep) => {
    let depPack = getPackageNameFromMessageType(dep.type);
    if (depPack === packageName) {
      if (isSrv) {
        w.write('const %s = require(\'../msg/%s.js\');', dep.name, dep.name);
      } else {
        w.write('const %s = require(\'./%s.js\');', dep.name, dep.name);
      }
    }
    else {
      w.write('const %s = _finder(\'%s\');', depPack, depPack);
    }
  });

  w.newline();
  w.dividingLine();
  w.newline();
}

function getDefaultValue(field, packageName) {
  if (field.isArray) {
    if (!field.arrayLen) {
      return '[]';
    }
    else {
      let fieldCopy = Object.assign({}, field);
      fieldCopy.isArray = false;
      let fieldDefault = getDefaultValue(fieldCopy, packageName);
      return util.format('new Array(%s).fill(%s)', field.arrayLen, fieldDefault);
    }
  }
  else if (field.isBuiltin) {
    if (fieldsUtil.isString(field.type)) {
      return '\'\'';
    } else if (fieldsUtil.isTime(field.type)) {
      return '{secs: 0, nsecs: 0}';
    } else if (fieldsUtil.isBool(field.type)) {
      return 'false';
    } else if (fieldsUtil.isFloat(field.type)) {
      return '0.0'
    }
    // else is int
    return '0';
  }
  // else
  let fieldInfo = field.type.split('/');
  if (fieldInfo[0] === packageName) {
    return util.format('new %s()', fieldInfo[1]);
  }
  // else
  return util.format('new %s.msg.%s()',fieldInfo[0], fieldInfo[1]);
}

function writeMsgConstructorField(w, details, field) {
  w.write('if (initObj.hasOwnProperty(\'%s\')) {', field.name).indent();
  w.write('this.%s = initObj.%s;', field.name, field.name).dedent();
  w.write('}');
  w.write('else {').indent();
  w.write('this.%s = %s;', field.name, getDefaultValue(field, details.packageName)).dedent();
  w.write('}');
  w.newline();
}

function writeClass(w, details) {
  w.write('class %s {', details.messageName);
  w.indent();
  w.write('constructor(initObj) {');
  w.indent();
  details.fields.forEach((field) => {
    writeMsgConstructorField(w, details, field);
  });
  w.dedent().write('}').newline();
}

function writeSerializeLength(w, name) {
  w.write(`// Serialize the length for message field [${name}]`)
  .write(`bufferOffset = _serializer.uint32(obj.${name}.length, buffer, bufferOffset);`);
}

function writeSerializeLengthCheck(w, field) {
  w.write(`// Check that the constant length array field [${field.name}] has the right length`)
  .write(`if (obj.${field.name}.length !== ${field.arrayLen}) {`)
  .indent()
  .write(`throw new Error(\'Unable to serialize array field ${field.name} - length must be ${field.arrayLen}\')`)
  .dedent()
  .write('}');
}

function writeSerializeBuiltinField(w, f) {
  if (f.isArray) {
    if (f.type === 'uint8') {
      w.write(`buffer.write(obj.${f.name});`);
      w.write(`bufferOffset += obj.${f.name}.length;`);
    }
    else {
      w.write(`obj.${f.name}.forEach((val) => {`)
      .indent()
      .write(`bufferOffset = _serializer.${f.type}(val, buffer, bufferOffset);`)
      .dedent()
      .write('});');
    }
  }
  else {
    w.write(`bufferOffset = _serializer.${f.type}(obj.${f.name}, buffer, bufferOffset);`);
  }
}

function writeSerializeMessageField(w, f, thisPackage) {
  let fieldPackage = getPackageNameFromMessageType(f.type);
  let msgName = getMessageNameFromMessageType(f.type);
  let samePackage = (fieldPackage === thisPackage);
  if (f.isArray) {
    w.write(`obj.${f.name}.forEach((val) => {`)
    .indent();
    if (samePackage) {
      w.write(`bufferOffset = ${msgName}.serialize(val, buffer, bufferOffset);`);
    }
    else {
      w.write(`bufferOffset = ${fieldPackage}.msg.${msgName}.serialize(val, buffer, bufferOffset);`);
    }
    w.dedent()
    .write('});');
  }
  else {
    if (samePackage) {
      w.write(`bufferOffset = ${msgName}.serialize(obj.${f.name}, buffer, bufferOffset);`);
    }
    else {
      w.write(`bufferOffset = ${fieldPackage}.msg.${msgName}.serialize(obj.${f.name}, buffer, bufferOffset);`);
    }
  }
}

function writeSerializeField(w, field, packageName) {
  if (field.isArray) {
    if (!field.arrayLen) {
      writeSerializeLength(w, field.name);
    }
    else {
      writeSerializeLengthCheck(w, field);
    }
    w.newline();
  }
  w.write('// Serialize message field [%s]', field.name).newline();
  if (field.isBuiltin) {
    writeSerializeBuiltinField(w, field);
  }
  else {
    writeSerializeMessageField(w, field, packageName);
  }
  w.newline();
}

function writeSerialize(w, details) {
  w.write('static serialize(obj, buffer, bufferOffset) {')
  .indent()
  .write('// Serializes a message object of type %s', details.messageName);
  details.fields.forEach((field) => {
    writeSerializeField(w, field, details.packageName);
  });
  w.write('return bufferOffset;')
  .dedent()
  .write('}')
  .newline();
}

function writeDeserializeLength(w, name) {
  w.write(`// Deserialize array length for message field [${name}]`);
  w.write('len = _deserializer.uint32(buffer, bufferOffset);')
}

function writeDeserializeMessageField(w, field, thisPackage) {
  const fieldPackage = getPackageNameFromMessageType(field.baseType);
  const msgName = getMessageNameFromMessageType(field.baseType);
  const samePackage = (fieldPackage === thisPackage);
  if (field.isArray) {
    // only create a new array if it has a non-constant length
    if (!field.arrayLen) {
      w.write(`data.${field.name} = new Array(len);`);
    }
    w.write('for (let i = 0; i < len; ++i) {')
    .indent();
    if (samePackage) {
      w.write(`data.${field.name}[i] = ${msgName}.deserialize(buffer, bufferOffset);`);
    }
    else {
      w.write(`data.${field.name}[i] = ${fieldPackage}.msg.${msgName}.deserialize(buffer, bufferOffset);`);
    }
    w.write('}');
  }
  else {
    if (samePackage) {
      w.write(`data.${field.name} = ${msgName}.deserialize(buffer, bufferOffset);`);
    }
    else {
      w.write(`data.${field.name} = ${fieldPackage}.msg.${msgName}.deserialize(buffer, bufferOffset);`);
    }
  }
}

function writeDeserializeBuiltinField(w, field) {
  if (field.isArray) {
    if (field.baseType === 'uint8') {
      w.write(`data.${field.name} = buffer.slice(0, len);`);
      w.write('bufferOffset[0] += len;');
    }
    else {
      // only create a new array if it has a non-constant length
      if (!field.arrayLen) {
        w.write(`data.${field.name} = new Array(len);`);
      }
      w.write('for (let i = 0; i < len; ++i) {')
      .indent()
      .write(`data.${field.name}[i] = _deserializer.${field.baseType}(buffer, bufferOffset);`)
      .dedent()
      .write('}');
    }
  }
  else {
    w.write(`data.${field.name} = _deserializer.${field.baseType}(bufferInfo, bufferOffset);`);
  }
}

function writeDeserializeField(w, field, packageName) {
  if (field.isArray) {
    if (!field.arrayLen) {
      writeDeserializeLength(w, field.name);
    }
    else {
      w.write(`len = ${field.arrayLen};`);
    }
  }
  w.write(`// Deserialize message field [${field.name}]`).newline();
  if (field.isBuiltin) {
    writeDeserializeBuiltinField(w, field);
  }
  else {
    writeDeserializeMessageField(w, field, packageName);
  }
  w.newline()
}

function writeDeserialize(w, details) {
  w.write('static deserialize(buffer, bufferOffset) {')
  .indent()
  .write('// Deserializes a message object of type %s', details.messageName);
  details.fields.forEach((field) => {
    writeDeserializeField(w, field, details.packageName);
  });
  w.write('return data;')
  .dedent()
  .write('}')
  .newline();
}


/** Construct the class definition for the given message type. The
 * resulting class holds the data and has the methods required for
 * use with ROS, incl. serialization, deserialization, and md5sum. */
function buildMessageClass(details) {
  const fileWriter = new IndentedWriter();
  writeHeader(fileWriter, details);
  writeRequires(fileWriter, details, false);
  writeClass(fileWriter, details);
  writeSerialize(fileWriter, details);
  writeDeserialize(fileWriter, details);
  writeGetMessageSize(s, spec, search_path);
  writeGetMessageFixedSize(s, spec, search_path)
  write_ros_datatype(s, spec)
  write_md5sum(s, context, spec)
  write_message_definition(s, context, spec)
  fileWriter.write('};').newline()
  write_constants(s, spec)
  console.log('CLASS SO FAR:\n' + fileWriter.get());

  function Message(values) {
    if (!(this instanceof Message)) {
      return new Message(values);
    }

    var that = this;

    if (details.constants) {
      details.constants.forEach(function(field) {
        that[field.name] = field.value || null;
      });
    }

    if (details.fields) {
      details.fields.forEach(function(field) {
        if (field.messageType) {
          // sub-message class
          that[field.name] =
            new (field.messageType)(values ? values[field.name] : undefined);
        } else {
          // simple value
          that[field.name] = values ? values[field.name] :
            (field.value || fieldsUtil.getDefaultValue(field.type));
        }
      });
    }
  };

  Message.messageType = Message.prototype.messageType = details.type;
  Message.packageName = Message.prototype.packageName = details.packageName;
  Message.messageName = Message.prototype.messageName = details.messageName;
  Message.md5         = Message.prototype.md5         = details.md5;
  Message.md5sum      = Message.prototype.md5sum      = function() {
    return this.md5;
  };
  Message.Constants = Message.constants
    = Message.prototype.constants   = details.constants;
  Message.fields      = Message.prototype.fields      = details.fields;
  Message.serialize   = Message.prototype.serialize   = function(obj, buffer) {
      return serializeInnerMessage(obj, buffer, 0);
    };
  Message.deserialize = Message.prototype.deserialize = function(buffer, bufferOffset) {
    return deserializeInnerMessage(new Message(), buffer, bufferOffset);
  };

  return Message;
}

// ---------------------------------------------------------

function getMessageType(packageName, messageName) {
  return packageName ? packageName + '/' + messageName
    : messageName;
}

function getPackageNameFromMessageType(messageType) {
  return messageType.indexOf('/') !== -1 ? messageType.split('/')[0]
    : '';
}

var isNormalizedMessageType = /.*\/.*$/;
function normalizeMessageType(messageType, packageName) {
  var normalizedMessageType = messageType;
  if (messageType == "Header") {
    normalizedMessageType = getMessageType("std_msgs", messageType);
  } else if (messageType.match(isNormalizedMessageType) === null) {
    normalizedMessageType = getMessageType(packageName, messageType);
  }

  return normalizedMessageType;
}

function getMessageNameFromMessageType(messageType) {
  return messageType.indexOf('/') !== -1 ? messageType.split('/')[1]
                                         : messageType;
}

// ---------------------------------------------------------
// Serialize

function serializeInnerMessage(message, buffer, bufferOffset) {
  message.fields.forEach(function(field) {
    var fieldValue = message[field.name];

    if (fieldsUtil.isPrimitive(field.type)) {
      fieldsUtil.serializePrimitive(
        field.type, fieldValue, buffer, bufferOffset);
      bufferOffset += fieldsUtil.getPrimitiveSize(field.type, fieldValue);
    }
    else if (fieldsUtil.isArray(field.type)) {
      buffer.writeUInt32LE(fieldValue.length, bufferOffset);
      bufferOffset += 4;

      var arrayType = fieldsUtil.getTypeOfArray(field.type);
      fieldValue.forEach(function(value) {
        if (fieldsUtil.isPrimitive(arrayType)) {
          fieldsUtil.serializePrimitive(
            arrayType, value, buffer, bufferOffset);
          bufferOffset += fieldsUtil.getPrimitiveSize(arrayType, value);
        }
        else if (fieldsUtil.isMessage(arrayType)) {
          serializeInnerMessage(value, buffer, bufferOffset);
          bufferOffset += fieldsUtil.getMessageSize(value)
        }
      });
    }
    else if (fieldsUtil.isMessage(field.type)) {
      serializeInnerMessage(fieldValue, buffer, bufferOffset)
      bufferOffset += fieldsUtil.getMessageSize(fieldValue)
    }
  });
}

// ---------------------------------------------------------
// Deserialize


function deserializeInnerMessage(message, buffer, bufferOffset) {
  message.fields.forEach(function(field) {
    var fieldValue = message[field.name];

    if (fieldsUtil.isPrimitive(field.type)) {
      fieldValue = fieldsUtil.deserializePrimitive(
        field.type, buffer, bufferOffset)
      bufferOffset += fieldsUtil.getPrimitiveSize(field.type, fieldValue)
    }
    else if (fieldsUtil.isArray(field.type)) {
      var array     = []
        , arraySize = buffer.readUInt32LE(bufferOffset)
        , arrayType = fieldsUtil.getTypeOfArray(field.type)
        ;
      bufferOffset += 4;

      for (var i = 0; i < arraySize; i++) {
        if (fieldsUtil.isPrimitive(arrayType)) {
          var value = fieldsUtil.deserializePrimitive(
            arrayType, buffer, bufferOffset);
          bufferOffset += fieldsUtil.getPrimitiveSize(arrayType, value);
          array.push(value);
        }
        else if (fieldsUtil.isMessage(arrayType)) {
          var arrayMessage = new field.messageType();
          arrayMessage = deserializeInnerMessage(
            arrayMessage, buffer, bufferOffset);
          bufferOffset += fieldsUtil.getMessageSize(arrayMessage);
          array.push(arrayMessage);
        }
      }
      fieldValue = array;
    }
    else if (fieldsUtil.isMessage(field.type)) {
      var innerMessage = new field.messageType();
      fieldValue = deserializeInnerMessage(
        innerMessage, buffer, bufferOffset);
      bufferOffset += fieldsUtil.getMessageSize(fieldValue);
    }

    message[field.name] = fieldValue;
  });

  return message;
};

// ---------------------------------------------------------

module.exports = messages;
