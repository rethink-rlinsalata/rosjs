/*
 *    Copyright 2016 Rethink Robotics
 *
 *    Copyright 2016 Chris Smith
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

'use strict';

const ros_msg_utils = require('ros_msg_utils');
const base_serializers = ros_msg_utils.Serialize;
const base_deserializers = ros_msg_utils.Deserialize;

//-----------------------------------------------------------------------

let callerIdPrefix = 'callerid=';
let md5Prefix = 'md5sum=';
let topicPrefix = 'topic=';
let servicePrefix = 'service=';
let typePrefix = 'type=';
let latchingPrefix = 'latching=';
let persistentPrefix = 'persistent=';

//-----------------------------------------------------------------------

function serializeStringFields(fields) {
  let length = 0;
  fields.forEach((field) => {
    length += (field.length + 4);
  });
  let buffer = new Buffer(4 + length);
  let offset = base_serializers.uint32(length, buffer, 0);

  fields.forEach((field) => {
    offset = base_serializers.string(field, buffer, offset);
  });
  return buffer;
}

let TcprosUtils = {

  createSubHeader(callerId, md5sum, topic, type) {
    const fields = [
      callerIdPrefix + callerId,
      md5Prefix + md5sum,
      topicPrefix + topic,
      typePrefix + type
    ];
    return serializeStringFields(fields);
  },

  createPubHeader(callerId, md5sum, type, latching) {
    const fields = [
      callerIdPrefix + callerId,
      md5Prefix + md5sum,
      typePrefix + type,
      latchingPrefix + latching
    ];
    return serializeStringFields(fields);
  },

  createServiceClientHeader(callerId, service, md5sum, type, persistent) {
    const fields = [
      callerIdPrefix + callerId,
      servicePrefix + service,
      md5Prefix + md5sum,
    ];

    if (persistent) {
      fields.push(persistentPrefix + '1');
    }
    return serializeStringFields(fields);
  },

  createServiceServerHeader(callerId, md5sum, type) {
    const fields = [
      callerIdPrefix + callerId,
      md5Prefix + md5sum,
      typePrefix + type
    ];
    return serializeStringFields(fields);
  },

  parseTcpRosHeader(header) {
    let info = {};
    while (header.length !== 0) {
      const {string, buffer} = this.deserializeString(header, true);
      header = buffer;

      let matchResult = string.match(/^(\w+)=(.+)/m);
      // invalid connection header
      if (!matchResult) {
        console.error('Invalid connection header while parsing field %s', field);
        return null;
      }
      // else
      info[matchResult[1]] = matchResult[2];
    }
    return info;
  },

  parseSubHeader(header) {
    let i = 0;
    let info = {};
    while ( header.length !== 0 ) {
      const {string: field, buffer} = this.deserializeString(header, true);
      header = buffer;
      
      if (field.startsWith(md5Prefix)) {
        info.md5sum = field.substr(md5Prefix.length);
      }
      else if (field.startsWith(topicPrefix)) {
        info.topic = field.substr(topicPrefix.length);
      }
      else if (field.startsWith(callerIdPrefix)) {
        info.callerId = field.substr(callerIdPrefix.length);
      }
      else if (field.startsWith(typePrefix)) {
        info.type = field.substr(typePrefix.length);
      }
      ++i;
    }
    return info;
  },

  parsePubHeader(header) {
    let i = 0;
    let info = {};
    while ( header.length !== 0 ) {
      const {string: field, buffer} = this.deserializeString(header, true);
      header = buffer;
      
      if (field.startsWith(md5Prefix)) {
        info.md5sum = field.substr(md5Prefix.length);
      }
      else if (field.startsWith(latchingPrefix)) {
        info.latching = field.substr(latchingPrefix.length);
      }
      else if (field.startsWith(callerIdPrefix)) {
        info.callerId = field.substr(callerIdPrefix.length);
      }
      else if (field.startsWith(typePrefix)) {
        info.type = field.substr(typePrefix.length);
      }
      ++i;
    }
    return info;
  },

  parseServiceClientHeader(header) {
    let i = 0;
    let info = {};
    while ( header.length !== 0 ) {
      const {string: field, buffer} = this.deserializeString(header, true);
      header = buffer;

      if (field.startsWith(md5Prefix)) {
        info.md5sum = field.substr(md5Prefix.length);
      }
      else if (field.startsWith(servicePrefix)) {
        info.service = field.substr(servicePrefix.length);
      }
      else if (field.startsWith(callerIdPrefix)) {
        info.callerId = field.substr(callerIdPrefix.length);
      }
      else if (field.startsWith(typePrefix)) {
        info.type = field.substr(typePrefix.length);
      }
      ++i;
    }
    return info;
  },

  parseServiceServerHeader(header) {
    let i = 0;
    let info = {};
    while ( header.length !== 0 ) {
      const {string: field, buffer} = this.deserializeString(header, true);
      header = buffer;
      
      if (field.startsWith(md5Prefix)) {
        info.md5sum = field.substr(md5Prefix.length);
      }
      else if (field.startsWith(callerIdPrefix)) {
        info.callerId = field.substr(callerIdPrefix.length);
      }
      else if (field.startsWith(typePrefix)) {
        info.type = field.substr(typePrefix.length);
      }
      ++i;
    }
    return info;
  },

  validateSubHeader(header, topic, type, md5sum) {
    if (!header.hasOwnProperty('topic')) {
      return this.serializeString('Connection header missing expected field [topic]');
    }
    else if (!header.hasOwnProperty('type')) {
      return this.serializeString('Connection header missing expected field [type]');
    }
    else if (!header.hasOwnProperty('md5sum')) {
      return this.serializeString('Connection header missing expected field [md5sum]');
    }
    else if (header.topic !== topic) {
      return this.serializeString('Got incorrect topic [' + header.topic + '] expected [' + topic + ']');
    }
    // rostopic will send '*' for some commands (hz)
    else if (header.type !== type && header.type !== '*') {
      return this.serializeString('Got incorrect message type [' + header.type + '] expected [' + type + ']');
    }
    else if (header.md5sum !== md5sum && header.md5sum !== '*') {
      return this.serializeString('Got incorrect md5sum [' + header.md5sum + '] expected [' + md5sum + ']');
    }
    // else
    return null;
  },

  serializeMessage(MessageClass, message, prependMessageLength=true) {
    const msgSize = MessageClass.getMessageSize(message);
    let msgBuffer;
    let offset = 0;
    if (prependMessageLength) {
      msgBuffer = new Buffer(msgSize + 4);
      offset = base_serializers.uint32(msgSize, msgBuffer, 0);
    }
    else {
      msgBuffer = new Buffer(msgSize);
    }

    MessageClass.serialize(message, msgBuffer, offset);
    return msgBuffer;
  },

  serializeServiceResponse(ResponseClass, response, success, prependResponseInfo=true) {
    let responseBuffer;
    if (prependResponseInfo) {
      if (success) {
        const respSize = ResponseClass.getMessageSize(response);
        responseBuffer = new Buffer(respSize + 5);

        // add the success byte
        base_serializers.uint8(1, responseBuffer, 0);
        // add the message length
        base_serializers.uint32(respSize, responseBuffer, 1);
        ResponseClass.serialize(response, responseBuffer, 5);
      }
      else {
        const errorMessage = 'Unable to handle service call';
        const errLen = errorMessage.length;
        // FIXME: check that we don't need the extra 4 byte message len here
        responseBuffer = new Buffer(5 + errLen);
        base_serializers.uint8(0, responseBuffer, 0);
        base_serializers.string(errorMessage, responseBuffer, 1);
      }
    }
    else {
      responseBuffer = new Buffer(ResponseClass.getMessageSize(response));
    }

    return responseBuffer;
  },

  deserializeMessage(MessageClass, messageBuffer) {
    return MessageClass.deserialize(messageBuffer, [0]);
  },

  serializeString(str) {
    const buf = new Buffer(str.length + 4);
    base_serializers.string(str, buf, 0);
    return buf;
  },

  deserializeString(buffer, sliceBuffer=false) {
    if (sliceBuffer) {
      const offset = [0];
      const val = base_deserializers.string(buffer, offset);
      buffer = buffer.slice(offset[0]);
      return {string: val, buffer}
    }
    // else
    return base_deserializers.string(buffer, [0]);
  }
};

//-----------------------------------------------------------------------

module.exports = TcprosUtils;
