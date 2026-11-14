const ENV = require('./env');

module.exports =
  ENV.USE_LOCAL_DB || ENV.NODE_ENV === 'test' ? require('./localMongoose') : require('mongoose');
