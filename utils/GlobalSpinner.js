'use strict';

const DEFAULT_SPIN_RATE_HZ = 200;
const LoggingManager = require('../lib/Logging.js');
const log = LoggingManager.getLogger('ros.spinner');

/**
 * @class ClientQueue
 * Queue of messages to handle for an individual client (subscriber or publisher)
 */
class ClientQueue {
  constructor(client, queueSize, throttleMs) {
    if (queueSize < 1) {
      throw new Error(`Unable to create client message queue with size ${queueSize} - minimum is 1`);
    }

    this._client = client;

    this._queue = [];
    this._queueSize = queueSize;

    this.throttleMs = throttleMs;
    this._handleTime = null;
  }

  push(item) {
    // console.log(`push onto ${this._client.getTopic()}`);
    this._queue.push(item);
    if (this.length > this._queueSize) {
      this._queue.shift();
    }
  }

  get length() {
    return this._queue.length;
  }

  handleClientMessages(time) {
    if (this._handleTime === null || time - this._handleTime > this.throttleMs) {
      // console.log(`Handling message queue for client ${this._client.getTopic()}`);
      this._handleTime = time;
      this._client._handleMsgQueue(this._queue);
      this._queue = [];
      // console.log(`Queue size for ${this._client.getTopic()} post handling: ${this.length}`);
      return true;
    }
    // else
    return false;
  }
}

/**
 * @class GlobalSpinner
 */
class GlobalSpinner {
  constructor(spinRate=DEFAULT_SPIN_RATE_HZ) {
    if (typeof spinRate !== 'number') {
      spinRate = DEFAULT_SPIN_RATE_HZ;
    }

    this._spinTime = 1 / spinRate;
    this._expectedSpinExpire = null;
    this._spinTimer = null;

    this._clientCallQueue = new Set();
    this._clientQueueMap = new Map();
  }

  addClient(client, clientId, queueSize, throttleMs) {
    if (queueSize > 0) {
      this._clientQueueMap.set(clientId, new ClientQueue(client, queueSize, throttleMs));
    }
  }

  /**
   * When subscribers/publishers receive new messages to handle, they will
   * "ping" the spinner.
   * @param client
   * @param msg
   */
  ping(clientId, msg) {
    this._queueMessage(clientId, msg);
    this._clientCallQueue.add(clientId);
    // console.log(`client ${clientId} in call queue: ${this._clientCallQueue.has(clientId)}`);
    this._setTimer();
  }

  disconnect(clientId) {
    // console.log('deleting %s from spinner', clientId);
    this._clientCallQueue.delete(clientId);
    this._clientQueueMap.delete(clientId);
  }

  _queueMessage(clientId, message) {
    const clientQueue = this._clientQueueMap.get(clientId);
    if (!clientQueue) {
      throw new Error('Unable to queue message for unknown client');
    }
    // else
    clientQueue.push(message);
  }

  _getClientsWithQueuedMessages() {
    const clients = {};
    this._clientQueueMap.forEach((value, clientId) => {
      const queueSize = value.length;
      clients[clientId] = queueSize;
      if (queueSize > 0 && !this._clientCallQueue.has(clientId)) {
        // console.log(value);
        throw new Error(`Client ${clientId} has ${value.length} queued messages but is not in call list!`);
      }
    });
  }

  _setTimer() {
    if (this._spinTimer === null) {
      this._spinTimer = setTimeout(this._handleQueue.bind(this), this._spinTime);
      this._expectedSpinExpire = Date.now() + this._spinTime;
    }
  }

  _handleQueue() {
    const now = Date.now();
    const keepOnQueue = [];
    this._clientCallQueue.forEach((clientId) => {
      const clientQueue = this._clientQueueMap.get(clientId);
      if (!clientQueue.handleClientMessages(now)) {
        keepOnQueue.push(clientId);
      }
    });

    // TODO: figure out if these clients that are throttling messages are
    // consistently keeping the timer running when it otherwise wouldn't be
    // and eating up CPU. Consider starting a slower timer if the least-throttled
    // client won't be handled for N cycles (e.g N === 5).
    this._spinTimer = null;

    this._getClientsWithQueuedMessages();

    if (keepOnQueue.length > 0) {
      // console.log('Carrying over messages from %j', keepOnQueue);
      this._clientCallQueue = new Set(keepOnQueue);
    }
    else {
      this._clientCallQueue.clear();
    }

    if (this._clientCallQueue.size > 0) {
      this._setTimer();
    }
  }
}

module.exports = GlobalSpinner;