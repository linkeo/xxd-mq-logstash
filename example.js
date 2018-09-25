const MQ = require('./index'); // require('xxd-mq-logstash');

const queue = new MQ({
  server: 'amqp://user:pass@127.0.0.1/path',
  queue: 'some:queue',

  // define queue global payload
  payload: {
    project: 'example-project',
  },
});

queue.push({
  message: 'Hello world',
  // Auto append @timestamp
});
