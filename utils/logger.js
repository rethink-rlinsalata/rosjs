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
let bunyan = require('bunyan');
let util = require('util');

//-----------------------------------------------------------------------

let defaultFormatter = function(name, msg, level) {
  let now =  moment().format('YYYY-MM-DD HH:mm:ss.SSSZZ');
  let timeMsg = '[' + nameFromLevel[level] + '] ' + now + ': ' + msg;
  if (name) {
    return '[' + name + ']' + timeMsg;
  }
  return timeMsg;
};

let logger;
let loggerMap = {};

//-----------------------------------------------------------------------

class Logger {
  constructor(options) {
    options = options || {};

    this._name = options.name;

    if (options.parent) {
      this._logger = options.parent.child(options);
    }
    else {
      this._logger = bunyan.createLogger({
        name: this._name,
        level: options.level || bunyan.INFO,
        streams: options.streams
      });
    }

    this._throttledLogs = new Set();
    this._onceLogs = new Set();

    // this.trace = this._logger.trace.bind(this._logger);
    // this.debug = this._logger.debug.bind(this._logger);
    // this.info = this._logger.info.bind(this._logger);
    // this.warn = this._logger.warn.bind(this._logger);
    // this.error = this._logger.error.bind(this._logger);
    // this.fatal = this._logger.fatal.bind(this._logger);

    let logMethods = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    this._createLogMethods(logMethods);
    this._createThrottleLogMethods(logMethods);
    this._createOnceLogMethods(logMethods);
  }

  setLevel(level) {
    this._logger.level(level);
  }

  getLevel() {
    return this._logger.level();
  }

  getName() {
    return this._name;
  }

  _createLogMethods(methods) {
    methods.forEach((method) => {
      if (this.hasOwnProperty(method)) {
        throw new Error('Unable to create method %s', method);
      }
      this[method] = this._logger[method].bind(this._logger);
      this[method]('adding method %s', method);
    });
  }

  _createThrottleLogMethods(methods) {
    methods.forEach((method) => {
      let throttleMethod = method + 'Throttle';
      if (this.hasOwnProperty(throttleMethod)) {
        throw new Error('Unable to create method %s', throttleMethod);
      }

      // there's currently a bug using arguments in a () => {} function
      this[throttleMethod] = function(throttleTime, args) {
        if (this[method]() && !this._throttle(arguments)) {
          return this[method].apply(this, Array.from(arguments).slice(1));
        }
        return false;
      }.bind(this);
    });
  }

  _createOnceLogMethods(methods) {
    methods.forEach((method) => {
      let onceMethod = method + 'Once';
      if (this.hasOwnProperty(onceMethod)) {
        throw new Error('Unable to create method %s', onceMethod);
      }

      // there's currently a bug using arguments in a () => {} function
      this[onceMethod] = function(args) {
        if (this[method]() && this._once(arguments)) {
          return this[method].apply(this, arguments);
        }
        return false;
      }.bind(this);
    });
  }

  //--------------------------------------------------------------
  // Throttled loggers
  //  These will generally be slower. Performance will also degrade the more
  //  places where you throttle your logs. Keep this in mind. Make child loggers.
  //--------------------------------------------------------------

  /**
   * Handles throttling logic for each log statement. Throttles logs by attempting
   * to create a string log 'key' from the arguments.
   * @param args {Array} arguments provided to calling function
   * @return {boolean} should this log be throttled (if true, the log should not be written)
   */
  _throttle(args) {
    const timeArg = args[0];
    let stringArg = args[1];

    const addLog = (logId) => {
      this._throttledLogs.add(logId);
      setTimeout(() => {
        this._throttledLogs.delete(logId)
      }, timeArg);
    };

    if (typeof stringArg !== 'string' && !(stringArg instanceof String)) {
      if (typeof stringArg === 'object') {
        // if its an object, use its keys as a throttling key
        stringArg = Object.keys(stringArg).toString();
      }
      else {
        // can't create a key - just log it
        return false;
      }
    }

    if (!this._throttledLogs.has(stringArg)) {
      addLog(stringArg);
      return false;
    }
    return true;
  }

  //--------------------------------------------------------------
  // Throttled loggers
  //  These will generally be slower. Performance will also degrade the more
  //  places where you throttle your logs. Keep this in mind. Make child loggers.
  //--------------------------------------------------------------

  /**
   * Handles once logic for each log statement. Throttles logs by attempting
   * to create a string log 'key' from the arguments.
   * @param args {Array} arguments provided to calling function
   * @return {boolean} should this be written
   */
  _once(args) {
    let logKey = args[0];

    if (typeof logKey !== 'string' && !(logKey instanceof String)) {
      if (typeof logKey === 'object') {
        // if its an object, use its keys as a throttling key
        logKey = Object.keys(logKey).toString();
      }
      else {
        // can't create a key - just log it
        return true;
      }
    }

    if (!this._onceLogs.has(logKey)) {
      this._onceLogs.add(logKey);
      return true;
    }
    return false;
  }
};

//-----------------------------------------------------------------------

module.exports = {
  init(options) {
    if (!logger) {
      logger = new Logger(options);
    }
  },

  createLogger(options) {
    // initialize 'global' logger if needed
    if (!logger) {
      this.init();
    }

    options = options || {};
    let loggerName = options.name;
    if (!loggerName) {
      loggerName = 'DefaultLogger';
    }

    // if this logger doesn't exist yet, actually create it
    // with provided options
    // otherwise, we'll just return the existing logger
    if (!loggerMap.hasOwnProperty(loggerName)) {
      // have this new logger use the 'global' logger's streams
      options.streams = logger._streams;

      // use the 'global' logger's level if not specified
      if (!options.hasOwnProperty('level')) {
        options.level = logger.getLevel();
      }

      // add the logger to the map
      loggerMap[loggerName] = new Logger(options);
    }
    return loggerMap[loggerName];
  },

  getLogger(loggerName) {
    return logger; //Map[loggerName];
  },

  getLoggers() {
    return Object.keys(loggerMap);
  }
};
