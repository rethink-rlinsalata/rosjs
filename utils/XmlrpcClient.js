'use strict';
const xmlrpc = require('xmlrpc');

const CONNECTION_REFUSED='ECONNREFUSED';
const TRY_AGAIN_LIST = [1, 2, 2, 4, 4, 4, 4, 8, 8, 8, 8, 16, 32, 64, 128, 256, 512, 1000];

class XmlrpcCall {
  constructor(method, data, resolve, reject) {
    this.method = method;
    this.data = data;
    this.resolve = resolve;
    this.reject = reject;
  }

  call(client) {
    return new Promise((resolve, reject) => {
      client.methodCall(this.method, this.data, (err, resp) => {
        if (err || resp[0] !== 1) {
          reject(err, resp);
        }
        else {
          resolve(resp);
        }
      });
    });
  }
}

class XmlrpcClient {
  constructor(clientAddressInfo, log) {
    this._xmlrpcClient = xmlrpc.createClient(clientAddressInfo);

    this._log = log;

    this._callQueue = [];

    this._timeout = 0;
    this._timeoutId = null;
  }

  getClient() {
    return this._xmlrpcClient;
  }

  call(method, data, resolve, reject) {
    const newCall = new XmlrpcCall(method, data, resolve, reject);
    const numCalls = this._callQueue.length;
    this._callQueue.push(newCall);
    // if nothing else was on the queue, try executing the call now
    if (numCalls === 0) {
      this._tryExecuteCall();
    }
  }

  _tryExecuteCall() {
    if (this._callQueue.length === 0) {
      this._log.warn('Tried executing xmlprc call on empty queue');
      return;
    }
    // else
    const call = this._callQueue[0];
    this._log.info('Try execute call %s: %j', call.method, call.data);
    call.call(this._xmlrpcClient)
    .then((resp) => {
      // call succeeded, clean up and call its handler
      this._log.info('Call %s %j succeeded! %j', call.method, call.data, resp);
      this._shiftQueue();
      this._resetTimeout();
      call.resolve(resp);
    })
    .catch((err, resp) => {
      this._log.info('Call %s %j failed! %j, %j', call.method, call.data, err, resp);
      if (err && err.code === CONNECTION_REFUSED) {
        // Call failed to connect - try to connect again.
        // All future calls would have same error since they're
        // directed at the same xmlrpc server.
        this._scheduleTryAgain();
      }
      else {
        // call failed - move on.
        this._shiftQueue();
        this._resetTimeout();
        call.reject(err, resp);
      }
    })
    .then(() => {
      if (this._timeoutId === null && this._callQueue.length > 0) {
        this._tryExecuteCall();
      }
    });
  }

  _shiftQueue() {
    this._callQueue.shift();
  }

  _resetTimeout() {
    this._timeout = 0;
    this._timeoutId = null;
  }

  _scheduleTryAgain() {
    const timeout = TRY_AGAIN_LIST[this._timeout];
    if (this._timeout + 1 < TRY_AGAIN_LIST.length) {
      ++this._timeout;
    }
    this._log.info('Scheduling call again in %dms', timeout);
    this._timeoutId = setTimeout(this._tryExecuteCall.bind(this), timeout);
  }
}

module.exports = XmlrpcClient;