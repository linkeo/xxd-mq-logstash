'use strict';

const mq = require('amqplib');
const log = require('xxd-log');
const debug = require('debug')('xxd:logstash');
const _ = require('lodash');
const co = require('co');

module.exports = class LogstashMQ {
  /**
   * @param {object} options 
   * @param {string} options.server Server Url
   * @param {string} options.queue
   * @param {number} [options.evictTimeout=5000] Timeout that will auto close connection in idle state.
   * @param {object} options.payload
   */
  constructor(options) {
    const server = _.get(options, 'server');
    const queue = _.get(options, 'queue');
    const basePayload = _.get(options, 'payload');
    const evictTimeout = Number(_.get(options, 'evictTimeout')) || 5000;

    if (!server) { throw new Error('[xxd-logstash] RabbitMQ Service is not provided.'); }
    if (!queue) { throw new Error('[xxd-logstash] RabbitMQ Queue is not provided.'); }

    let conn;
    let channel;
    let ready = false;
    let qassert = false;
    let lastAccess = Date.now();
    let evictTimer;
    let _up;

    /**
     * @param {object} payload
     */
    this.push = (payload) => {
      const _payload = JSON.stringify(Object.assign({}, basePayload, { '@timestamp': new Date() }, payload));
      function* send() {
        let error;
        if (!qassert) {
          try {
            yield channel.assertQueue(queue);
            qassert = true;
          } catch (err) {
            error = err;
            qassert = false;
          }
        }
        if (qassert) {
          channel.sendToQueue(queue, Buffer.from(_payload));
          debug(`[${server}] Send payload to queue "${queue}": ${_payload}`);
        } else {
          throw new Error(`Assert queue "${queue}" failed. Cannot send payload "${_payload}": ${error && error.message}`);
        }
      }
      co(function* () {
        lastAccess = Date.now();
        debug(`[${server}] check ready: ${ready}`);
        if (!ready) {
          if (!_up) {
            _up = co(up());
          }
          try {
            yield _up;
          } catch (err) {
            throw err;
          } finally {
            _up = undefined;
          }
        }
        yield send();
        lastAccess = Date.now();
      }).catch(err => {
        log.error(`Error sending payload to queue "${queue}": ${err.stack}`);
      });
    };

    function* up() {
      debug(`[${server}] up...`);
      conn = yield mq.connect(server, { heartbeat: 1 });
      channel = yield conn.createChannel();
      lastAccess = Date.now();
      ready = true;
      qassert = {};
      evictTimer = setInterval(() => {
        if (ready && (Date.now() - lastAccess > evictTimeout)) {
          co(down).catch(err => log.error(`Error during down: ${err.stack}`));
        }
      }, 500);
      debug(`[${server}] up...done`);
    }

    function* down() {
      debug(`[${server}] down...`);
      ready = false;
      qassert = {};
      const _channel = channel;
      const _conn = conn;
      clearInterval(evictTimer);
      evictTimer = undefined;
      _channel && (yield _channel.close());
      _conn && (yield _conn.close());
      debug(`[${server}] down...done`);
    }
  }
};
