const { default: JSDOMEnvironment } = require('jest-environment-jsdom');

/** jsdom has no fetch API; hand it the Node ones so code under test can create Responses. */
class JSDOMWithFetch extends JSDOMEnvironment {
  constructor(...args) {
    super(...args);
    Object.assign(this.global, { Response, Request, Headers, fetch });
  }
}

module.exports = JSDOMWithFetch;
