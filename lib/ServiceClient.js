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

"use strict";

let net = require('net');
let NetworkUtils = require('../utils/network_utils.js');
const ros_msg_utils = require('ros_msg_utils');
const base_serializers = ros_msg_utils.Serialize;
let SerializationUtils = require('../utils/serialization_utils.js');
let DeserializeStream = SerializationUtils.DeserializeStream;
let Deserialize = SerializationUtils.Deserialize;
let Serialize = SerializationUtils.Serialize;
let TcprosUtils = require('../utils/tcpros_utils.js');
let EventEmitter = require('events');
let Logging = require('./Logging.js');

class ServiceCall {
  constructor(request, resolve, reject) {
    this.request = request;
    this.resolve = resolve;
    this.reject = reject;

    this.serviceClient = null;
  }
}

class ServiceClient extends EventEmitter {
  constructor(options, nodeHandle) {
    super();
    this._service = options.service;

    this._type = options.type;

    this._persist = !!options.persist;

    this._maxQueueLength = options.queueLength || -1;

    this._calling = false;

    this._log = Logging.getLogger('ros.rosnodejs');

    this._nodeHandle = nodeHandle;

    this._messageHandler = options.typeClass;

    this._serviceClient = null;

    this._callQueue = [];
  };

  getService() {
    return this._service;
  }

  getType() {
    return this._type;
  }

  getPersist() {
    return this._persist;
  }

  isCallInProgress() {
    return this._calling;
  }

  close() {
    // don't remove service client if call is in progress
    if (!this.isCallInProgress()) {
      this._serviceClient = null;
    }
  }

  /**
   * Call the service - if a current call is in progress, nothing will be done
   * @return {Promise}
   */
  call(request) {
    return new Promise((resolve, reject) => {
      const newCall = new ServiceCall(request, resolve, reject);
      this._callQueue.push(newCall);

      // shift off old calls if user specified a max queue length
      if (this._maxQueueLength > 0 && this._callQueue.length > this._maxQueueLength) {
        const oldCall = this._callQueue.shift();
        oldCall.reject();
      }

      // if there weren't any other calls in the queue, execute this new call
      // otherwise new call will be handled in order when others complete
      if (this._callQueue.length === 1) {
        this._executeCall();
      }
    });
  }

  _executeCall() {
    if (this._callQueue.length === 0) {
      this._log.warn('Tried executing service call on empty queue');
      return;
    }
    // else
    const call = this._callQueue.shift();
    this._calling = true;
    // find the service uri
    (() => {
      // if we haven't connected to the service yet, create the connection
      // this will always be the case unless this is persistent service client
      // calling for a second time.
      if (!this.getPersist() || this._serviceClient === null) {
        return this._nodeHandle.lookupService(this.getService())
        .then((resp) => {
          let serviceUri = resp[2];
          // connect to the service
          return this._connectToService(
            NetworkUtils.getAddressAndPortFromUri(serviceUri), call
          );
        });
      }
      else {
        // this is a persistent service that we've already set up
        call.serviceClient = this._serviceClient;
        return Promise.resolve();
      }
    })()
    .then(() => {
      return this._sendRequest(call);
    })
    .then((msg) => {
      this._calling = false;
      this._scheduleNextCall();
      call.resolve(msg);
    })
    .catch((err) => {
      this._log.warn(`Error during service ${this.getService()} call ${err.stack}`);
      this._calling = false;
      this._scheduleNextCall();
      throw err;
    });
  }

  _scheduleNextCall() {
    if (this._callQueue.length > 0) {
      process.nextTick(this._executeCall.bind(this));
    }
  }

  _sendRequest(call) {
    // serialize request
    const serializedRequest = TcprosUtils.serializeMessage(this._messageHandler.Request, call.request);

    call.serviceClient.write(serializedRequest);

    return new Promise((resolve, reject) => {
      call.serviceClient.$deserializeStream.once('message', (msg, success) => {
        if (success) {
          resolve(this._messageHandler.Response.deserialize(msg));
        }
        else {
          this._log.warn('Service error: %s', msg);
          reject();
        }
      });
    });
  }

  _connectToService(serviceInfo, call) {
    this._log.debug('Service client ' + this.getService() + ' connecting to ' + JSON.stringify(serviceInfo));
    call.serviceClient = new net.Socket();
    if (this.getPersist()) {
      this._serviceClient = call.serviceClient;
    }

    call.serviceClient.connect(serviceInfo, () => {
      this._log.debug('Sending connection header');
      let serviceClientHeader = TcprosUtils.createServiceClientHeader(this._nodeHandle.getNodeName(),
        this.getService(), this._messageHandler.md5sum(), this.getType(), this.getPersist());
      call.serviceClient.write(serviceClientHeader);
    });

    let deserializer = new DeserializeStream();
    call.serviceClient.$deserializeStream = deserializer;
    call.serviceClient.pipe(deserializer);

    call.serviceClient.on('end', () => {
      call.serviceClient = null;
      // we could probably just always reset this._serviceClient to null here but...
      if (this.getPersist()) {
        this._serviceClient = null;
      }
    });

    return new Promise((resolve, reject) => {
      deserializer.once('message', (msg, success) => {
        if (!call.serviceClient.$initialized) {
          // TODO: validate header?
          let header = TcprosUtils.parseServiceServerHeader(msg);

          // stream deserialization for service response is different - set that up for next message
          deserializer.setServiceRespDeserialize();
          call.serviceClient.$initialized = true;
          resolve();
        }
      });
    });
  }
}

module.exports = ServiceClient;
