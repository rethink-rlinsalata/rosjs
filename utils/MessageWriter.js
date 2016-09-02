'use strict';

const fs = require('fs');
const util = require('util');
const IndentedWriter = require('./IndentedWriter.js');
const fieldsUtil = require('./fields.js');

module.exports = {
  createMessageClass(msgSpec) {
    let w = new IndentedWriter();
    writeHeader(w, msgSpec);
    writeRequires(w, msgSpec, false);
    writeClass(w, msgSpec);
    writeSerialize(w, msgSpec);
    writeDeserialize(w, msgSpec);
    writeGetMessageSize(w, msgSpec);
    writeRosDatatype(w, msgSpec);
    writeMd5sum(w, msgSpec);
    writeMessageDefinition(w, msgSpec);
    w.dedent('}').newline();
    writeConstants(w, msgSpec);
    w.write(`module.exports = ${msgSpec.messageName}`);

    return w.get();
  },

  createServiceClass(srvSpec) {
    let w = new IndentedWriter();
    writeHeader(w, srvSpec);
    const {localDeps, foundPackages} = writeRequires(w, srvSpec.request, true);
    writeRequires(w, srvSpec.response, true, foundPackages, localDeps);
    writeServiceComponent(w, srvSpec.request);
    writeServiceComponent(w, srvSpec.response);
    writeServiceEnd(w, srvSpec);

    return w.get();
  }
};

function writeHeader(w, spec) {
  w.dividingLine();
  w.write('// Auto-generated from package %s.', spec.packageName);
  w.write('// !! Do not edit !!');
  w.dividingLine();
  w.newline();
}

function writeRequires(w, spec, isSrv, previousPackages=null, previousDeps=null) {
  if (previousPackages === null) {
    w.write('"use strict";');
    w.newline();
    w.write('const _serializer = _ros_msg_utils.Serialize;');
    w.write('const _deserializer = _ros_msg_utils.Deserialize;');
    w.write('const _finder = _ros_msg_utils.Find;');
    previousPackages = new Set();
  }
  if (previousDeps === null) {
    previousDeps = new Set();
  }

  const packageName = spec.packageName;
  // a unique list of package-local dependencies on other messages
  const localDeps = new Set();
  // a unique list of other package dependencies
  const foundPackages = new Set();

  spec.fields.forEach((field) => {
    if (!field.isBuiltin) {
      const fieldPack = field.getPackage();
      if (fieldPack === packageName) {
        const fieldMsgType = field.getMessage();
        // don't require this type again
        if (!previousDeps.has(fieldMsgType) && !localDeps.has(fieldMsgType)) {
          localDeps.add(fieldMsgType);
          if (isSrv) {
            w.write('const %s = require(\'../msg/%s.js\');', fieldMsgType, fieldMsgType);
          } else {
            w.write('const %s = require(\'./%s.js\');', fieldMsgType, fieldMsgType);
          }
        }
      }
      else {
        // don't find this package again
        if (!previousPackages.has(fieldPack) && !foundPackages.has(fieldPack)) {
          foundPackages.add(fieldPack);
          w.write('const %s = _finder(\'%s\');', fieldPack, fieldPack);
        }
      }
    }
  });

  w.newline();
  w.dividingLine();
  w.newline();
  return {localDeps, foundPackages};
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
  let fieldInfo = field.baseType.split('/');
  if (fieldInfo[0] === packageName) {
    return util.format('new %s()', fieldInfo[1]);
  }
  // else
  return util.format('new %s.msg.%s()',fieldInfo[0], fieldInfo[1]);
}

function writeMsgConstructorField(w, spec, field) {
  w.write('if (initObj && initObj.hasOwnProperty(\'%s\')) {', field.name).indent();
  w.write('this.%s = initObj.%s;', field.name, field.name).dedent();
  w.write('}');
  w.write('else {').indent();
  w.write('this.%s = %s;', field.name, getDefaultValue(field, spec.packageName)).dedent();
  w.write('}');
  w.newline();
}

function writeClass(w, spec) {
  w.write('class %s {', spec.messageName);
  w.indent();
  w.write('constructor(initObj) {');
  w.indent();
  spec.fields.forEach((field) => {
    writeMsgConstructorField(w, spec, field);
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
    if (f.baseType === 'uint8') {
      w.write(`buffer.write(obj.${f.name});`);
      w.write(`bufferOffset += obj.${f.name}.length;`);
    }
    else {
      w.write(`obj.${f.name}.forEach((val) => {`)
        .indent()
        .write(`bufferOffset = _serializer.${f.baseType}(val, buffer, bufferOffset);`)
        .dedent()
        .write('});');
    }
  }
  else {
    w.write(`bufferOffset = _serializer.${f.baseType}(obj.${f.name}, buffer, bufferOffset);`);
  }
}

function writeSerializeMessageField(w, f, thisPackage) {
  let fieldPackage = fieldsUtil.getPackageNameFromMessageType(f.baseType);
  let msgName = fieldsUtil.getMessageNameFromMessageType(f.baseType);
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

function writeSerialize(w, spec) {
  w.write('static serialize(obj, buffer, bufferOffset) {')
    .indent()
    .write('// Serializes a message object of type %s', spec.messageName);
  spec.fields.forEach((field) => {
    writeSerializeField(w, field, spec.packageName);
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
  const fieldPackage = fieldsUtil.getPackageNameFromMessageType(field.baseType);
  const msgName = fieldsUtil.getMessageNameFromMessageType(field.baseType);
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
    w.dedent('}');
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
    w.write(`data.${field.name} = _deserializer.${field.baseType}(buffer, bufferOffset);`);
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

function writeDeserialize(w, spec) {
  w.write('static deserialize(buffer, bufferOffset=[0]) {')
    .indent('// Deserializes a message object of type %s', spec.messageName)
    .write('let data = new %s();', spec.messageName)
    .write('let len;');
  spec.fields.forEach((field) => {
    writeDeserializeField(w, field, spec.packageName);
  });
  w.write('return data;')
    .dedent()
    .write('}')
    .newline();
}

function getTypeSize(t) {
  switch(t) {
    case 'int8':
    case 'uint8':
    case 'byte':
    case 'bool':
    case 'char':
      return 1;
    case 'int16':
    case 'uint16':
      return 2;
    case 'int32':
    case 'uint32':
    case 'float32':
      return 4;
    case 'int64':
    case 'uint64':
    case 'float64':
    case 'time':
    case 'duration':
      return 8;
  }
  return null;
}

function writeGetMessageSize(w, spec) {
  // Write a static method to determine the buffer size of a complete message
  w.write('static getMessageSize(object) {');
  const msgSize = spec.getMessageFixedSize();
  if (msgSize !== null) {
    w.indent()
      .write(`return ${msgSize};`)
  }
  else {
    w.indent()
      .write('let length = 0;');

    // certain fields will always have the same size
    // calculate that here instead of dynamically every time
    let lenConstantLengthFields = 0;
    spec.fields.forEach((field) => {
      let fieldSize = 0;
      if (field.isBuiltin) {
        fieldSize = getTypeSize(field.baseType);
      }
      else {
        const fieldSpec = spec.getMsgSpecForType(field.baseType);
        if (!fieldSpec) {
          spec.getMsgSpecForType(field.baseType);
        }
        fieldSize = fieldSpec.getMessageFixedSize();
      }

      if (field.isArray) {
        if (field.arrayLen && fieldSize !== null) {
          lenConstantLengthFields += fieldSize * field.arrayLen;
          return;
        }
        else if (field.arrayLen === null) {
          // account for 4 byte array length
          lenConstantLengthFields += 4;
        }

        if (fieldSize === 1) {
          w.write(`length += object.${field.name}.length;`);
        }
        else if (fieldSize !== null) {
          w.write(`length += ${fieldSize} * object.${field.name}.length`);
        }
        else {
          let lineToWrite;
          if (field.isBuiltin) {
            if (!fieldsUtil.isString(field.baseType)) {
              throw new Error(`Unexpected field ${field.name} with type ${field.baseType} has unknown length`);
            }

            // it's a string array!
            lineToWrite = 'length += 4 + val.length;';
          }
          else {
            const [pkg, msgType] = field.baseType.split('/');
            const samePackage = (spec.packageName === pkg);
            if (samePackage) {
              lineToWrite = `length += ${msgType}.getMessageSize(object.${field.name}[i]);`;
            }
            else {
              lineToWrite = `length += ${pkg}.msg.${msgType}.getMessageSize(object.${field.name}[i]);`;
            }
          }

          w.write(`for(let i = 0; i < object.${field.name}.length; ++i) {`)
            .indent()
            .write(lineToWrite)
            .dedent()
            .write('}');
        }
      }
      else if (fieldSize !== null) {
        lenConstantLengthFields += fieldSize;
      }
      else {
        let lineToWrite;
        // field size is variable *blurgh blurgh*
        if (field.isBuiltin) {
          if (!fieldsUtil.isString(field.baseType)) {
            throw new Error(`Unexpected field ${field.name} with type ${field.baseType} has unknown length`);
          }
          // it's a string!
          // string length consumes 4 bytes in message
          lenConstantLengthFields += 4;
          lineToWrite = `length += object.${field.name}.length;`
        }
        else {
          const [pkg, msgType] = field.baseType.split('/');
          const samePackage = (spec.packageName === pkg);
          if (samePackage) {
            lineToWrite = `length += ${msgType}.getMessageSize(object.${field.name})`;
          }
          else {
            lineToWrite = `length += ${pkg}.msg.${msgType}.getMessageSize(object.${field.name})`;
          }
        }
        w.write(lineToWrite);
      }
    });

    if (lenConstantLengthFields > 0) {
      w.write(`// ${lenConstantLengthFields} is precalculated sum of the constant length fields`);
      w.write(`return length + ${lenConstantLengthFields};`);
    }
    else {
      w.write('return length;');
    }
  }
  w.dedent()
    .write('}')
    .newline()
}

function writeRosDatatype(w, spec) {
  w.write('static datatype() {')
    .indent(`// Returns string type for a ${spec.getFullMessageName()} object`)
    .write(`return '${spec.getFullMessageName()}';`)
    .dedent('}')
    .newline()
}

function writeMd5sum(w, spec) {
  w.write('static md5sum() {')
    .indent('// Returns md5sum of message object')
    .write(`return '${spec.getMd5sum()}'`)
    .dedent('}')
    .newline()
}

function writeMessageDefinition(w, spec) {
  w.write('static messageDefinition() {')
    .indent('// Returns full string definition for message')
    .write('return `');

  const lines = spec.fileContents.split('\n');
  lines.forEach((line) => {
    w.write(`${line}`);
  });
  w.write('`;')
    .dedent('}')
    .newline();
}

function writeConstants(w, spec) {
  if (spec.constants && spec.constants.length > 0) {
    w.write('// Constants for message')
      .write(`${spec.messageName}.Constants = {`)
      .indent();
    spec.constants.forEach((constant) => {
      if (fieldsUtil.isString(constant.type)) {
        w.write(`${constant.name.toUpperCase()}: '${constant.value}',`);
      }
      else {
        w.write(`${constant.name.toUpperCase()}: ${constant.value},`);
      }
    });
    w.dedent('}')
      .newline()
  }
}

function writeServiceComponent(w, spec) {
  writeClass(w, spec);
  writeSerialize(w, spec);
  writeDeserialize(w, spec);
  writeGetMessageSize(w, spec);
  writeRosDatatype(w, spec);
  writeMd5sum(w, spec);
  writeMessageDefinition(w, spec);
  w.dedent('}').newline();
  writeConstants(w, spec);
  w.dividingLine();
}

function writeServiceEnd(w, spec) {
  w.write('module.exports = {')
    .indent(`Request: ${spec.request.messageName},`)
    .write(`Response: ${spec.response.messageName},`)
    .write(`md5sum() { return '${spec.getMd5sum()}'; }`)
    .dedent('};')
    .newline();
}