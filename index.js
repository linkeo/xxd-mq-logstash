const mq = require('amqplib');
const log = require('xxd-log');
const debug = require('debug')('xxd:logstash');
const _ = require('lodash');

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

    if (!server) {
      throw new Error('[xxd-logstash] RabbitMQ Service is not provided.');
    }
    if (!queue) {
      throw new Error('[xxd-logstash] RabbitMQ Queue is not provided.');
    }

    /** @type {mq.Connection} */ let connection;
    /** @type {mq.Channel} */ let channel;
    /** @type {Promise|void} */ let connectPromise; // up promise
    /** @type {Promise|void} */ let assertPromise; // _assert promise
    let connected = false;
    let asserted = false;
    let lastAccess = Date.now();
    let evictTimer;
    let lastErrorTime = 0;

    /**
     * @param {object} payload
     */
    this.push = payload => {
      const fullPayload = JSON.stringify(
        Object.assign({}, basePayload, { '@timestamp': new Date() }, payload)
      );

      push(fullPayload).catch(err => {
        const now = Date.now();
        if (now - lastErrorTime > 1000) {
          log.error(`Error sending payload to queue "${queue}": ${err.stack}`);
        }
        lastErrorTime = now;
      });
    };

    async function push(payload) {
      if (!connected) {
        if (!connectPromise) {
          connectPromise = connect();
        }
        try {
          await connectPromise;
        } catch (err) {
          throw err;
        } finally {
          connectPromise = undefined;
        }
      }
      if (!asserted) {
        if (!assertPromise) {
          assertPromise = assert();
        }
        try {
          await assertPromise;
        } catch (err) {
          throw err;
        } finally {
          assertPromise = undefined;
        }
      }
      return send(payload);
    }

    async function send(payload) {
      if (!asserted) {
        throw new Error(
          `Cannot send payload to queue "${queue}", because queue is not asserted.`
        );
      }
      const result = channel.sendToQueue(queue, Buffer.from(payload));
      debug(`[${server}] Send payload to queue "${queue}": ${payload}`);
      return result;
    }

    async function assert() {
      if (!connected) {
        asserted = false;
        throw new Error('Cannot assert queue, because connection is closed.');
      }
      try {
        await channel.assertQueue(queue);
        asserted = true;
      } catch (err) {
        asserted = false;
        throw err;
      }
    }

    async function connect() {
      debug(`[${server}] connecting...`);

      // Create new connection
      connection = await mq.connect(
        server,
        { heartbeat: 1 }
      );
      connection.on('error', err => {
        connected = false;
        asserted = false;
        log.error(
          `Error threw by connection of queue "${queue}": ${err.stack}`
        );
      });
      connection.on('close', err => {
        connected = false;
        asserted = false;
        debug(`[${server}] Connection of queue "${queue}" is closed.`);
      });

      // Create new channel
      channel = await connection.createChannel();
      channel.on('error', err => {
        connected = false;
        asserted = false;
        log.error(`Error threw by channel of queue "${queue}": ${err.stack}`);
      });
      channel.on('close', err => {
        connected = false;
        asserted = false;
        debug(`[${server}] Channel of queue "${queue}" is closed.`);
      });
      lastAccess = Date.now();
      connected = true;
      asserted = false;
      evictTimer = setInterval(() => {
        if (connected && Date.now() - lastAccess > evictTimeout) {
          disconnect().catch(err =>
            log.error(`Error during disconnect: ${err.stack}`)
          );
        }
      }, 500);
      debug(`[${server}] connecting...done`);
    }

    async function disconnect() {
      if (!connected) {
        return;
      }
      debug(`[${server}] disconnecting...`);
      connected = false;
      asserted = false;
      const channelToClose = channel;
      const connectionToClose = connection;
      clearInterval(evictTimer);
      evictTimer = undefined;
      if (channelToClose) {
        await channelToClose.close();
      }
      if (connectionToClose) {
        await connectionToClose.close();
      }
      debug(`[${server}] disconnecting...done`);
    }
  }
};
