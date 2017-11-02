## 简介

本模块将数据格式化为JSON上传到指定的MQ队列中去，和Logstash并无直接关系。

### 特性

- 直接调用即可，无需回调／异步调用
- 连接闲置时会自动关闭

## 用法例子

### API访问日志

```js
// src/common/logstash.js
'use strict';

const config = require('./config').logstashmq || {};
const log = require('rainbowlog');
const MQ = require('xxd-mq-logstash');
const ms = require('pretty-ms');

const accessLog = (() => {
  try {
    return new MQ({
      server: config.server,
      queue: config.accessQueue,
      payload: { '@version': require('../../package.json').version },
    });
  } catch (err) {
    log.error('Error loading access log mq', err && err.message || err);
  }
})();

/**
 * @param {object} payload
 * @param {object} payload.method
 * @param {object} payload.path
 * @param {object} payload.params
 * @param {object} payload.context
 * @param {object} payload.elapseTime
 */
exports.accessLog = (payload) => {
  if (!payload) { return; }
  let message = `${payload.method} ${payload.path}`;
  if (payload.elapseTime) {
    message += `  (${ms(payload.elapseTime)})`;
  }
  payload.message = message;
  accessLog.push(payload);
};
```

```js
// src/lib/run.js
const logstash = require('../common/logstash');

// ...
logstash.accessLog({
  method: req.method,
  path: req.path,
  params: JSON.stringify(Object.assign({}, req.method === 'GET' ? req.query : req.body, req.params)),
  elapseTime: new Date().getTime() - cntTime.getTime(),
});
// ...
```

### 错误日志

```js
// src/common/logstash.js
'use strict';

const config = require('./config').logstashmq || {};
const log = require('rainbowlog');
const MQ = require('xxd-mq-logstash');
const ms = require('pretty-ms');

const errorLog = (() => {
  try {
    return new MQ({
      server: config.server,
      queue: config.errorQueue,
      payload: { '@version': require('../../package.json').version },
    });
  } catch (err) {
    log.error('Error loading error log mq', err && err.message || err);
  }
})();

/**
 * @param {Error} error
 * @param {object} extraPayload
 */
exports.errorLog = (error, extraPayload) => errorLog.push(Object.assign({}, extraPayload, {
  message: `${error.name || error.code}: ${error.message}`,
  stack: error.stack,
  code: error.code,
}));

```

```js
logstash.errorLog(err, {
  request: {
    route: `${req.method} ${req.path}`,
    params: JSON.stringify(Object.assign({}, req.method === 'GET' ? req.query : req.body, req.params)),
  }
});
```
