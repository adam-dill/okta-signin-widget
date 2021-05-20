import { RequestMock, Selector } from 'testcafe';
import PageObject from '../framework/page-objects/IdentityPageObject';
import { renderWidget } from '../framework/shared';
import { assertNoEnglishLeaks } from '../../../playground/LocaleUtils';
const fs = require('fs');
const path = require('path');

const PLAYGROUND = path.resolve(__dirname, '../../../playground');
const mocksFolder = `${PLAYGROUND}/mocks/data/idp/idx`;
const mocksOauth2Folder = `${PLAYGROUND}/mocks/data/oauth2`;

fixture('English Leaks')
  .page('http://localhost:3000')
  .clientScripts([
    // crypto.digest is not available for http
    {
      content: '\
        window.crypto.subtle = { \
          digest: (_alg, _buf) => { \
            return Promise.resolve(new ArrayBuffer()); \
          } \
        }; \
      '
    },
    // setNativeDialogHandler not working for some reason
    {
      content: '\
        window.alert = function(str) { \
          window._alert = str; \
        }; \
      '
    },
    // prevent initial playground render
    {
      content: '\
        window._isTestCafe = true; \
      '
    }
  ]);

// These mocks have known english leaks ignoring them temporarily
const ignoredMocks = [
  'success-with-interaction-code.json',
  'identify-with-third-party-idps.json',
  'identify-with-no-sso-extension.json',
  'identify-with-device-probing-loopback.json',
  'identify-with-device-probing-loopback-3.json',
  'identify-with-apple-redirect-sso-extension.json', // flaky on bacon
  'identify-unknown-user.json',
  'error-user-is-not-assigned.json',
  'error-internal-server-error.json',
  'error-identify-access-denied.json',
  'error-forgot-password.json',
  'error-email-verify.json',
  'error-403-security-access-denied.json',
  'consent-enduser.json',
  'authenticator-verification-select-authenticator.json',
  'authenticator-verification-okta-verify-signed-nonce-loopback.json',
  'authenticator-expired-password-with-enrollment-authenticator.json',
  'error-with-failure-redirect.json',
  'identify-recovery-with-recaptcha-v2.json'
];

const optionsForInteractionCodeFlow = {
  clientId: 'fake',
  useInteractionCodeFlow: true,
  codeVerifier: 'fake',
  codeChallenge: 'totally_fake',
  codeChallengeMethod: 'S256',
  authParams: {
    ignoreSignature: true,
    pkce: true,
  },
  stateToken: undefined
};
const mocksWithInteractionCodeFlow = [
  'success-with-interaction-code.json'
];

const parseMockData = () => {
  // parse mocks folder
  const mocks = [];
  // eslint-disable-next-line no-console
  console.log('================= Parsing mocks for en leaks automation =============');
  fs.readdirSync(mocksFolder).forEach(file => {
    const isIgnored = ignoredMocks.includes(file);
    if (!isIgnored) {
      mocks.push(file);
    } else {
      test.skip(`Warning skipping mock ${file} from test english leaks test suite. This file may result in english leaks on the UI.`, () => { });
    }
  });
  return mocks;
};

const setUpResponse = (filePath) => {
  const mockResponse = require(filePath);
  // Majority of the mock files can be loaded with just mocking the introspect API and providing a response
  // In some cases we may need to mock more than just introspect API to load the screen (example polling)
  // For those cases add the url and responses to responseMap

  // Needed for identify-with-apple-redirect-sso-extension
  const verifyUrl = 'http://localhost:3000/idp/idx/authenticators/sso_extension/transactions/123/verify?\
  challengeRequest=dummyvalue';

  const responseMap = [
    {
      'url': 'http://localhost:3000/idp/idx/introspect',
      'response': mockResponse
    },
    {
      'url': 'http://localhost:3000/idp/idx/challenge/poll',
      'response': mockResponse
    },
    // used for device probing mock
    {
      'url': 'http://localhost:3000/idp/idx/authenticators/poll',
      'response': mockResponse
    },
    // used for device probing mock
    {
      'url': 'http://localhost:3000/idp/idx/authenticators/poll/cancel',
      'response': mockResponse
    },
    {
      'url': verifyUrl,
      'response': '<html><h1>》ok_PL《</h1></html>'
    },
    {
      'url': 'http://localhost:3000/oauth2/default/v1/token',
      'response': require(`${mocksOauth2Folder}/success-tokens.json`)
    },
    {
      'url': 'http://localhost:3000/oauth2/default/v1/interact',
      'response': require(`${mocksOauth2Folder}/interact.json`)
    }
  ];

  const mock = RequestMock();
  for (let i = 0; i < responseMap.length; i++) {
    const url = responseMap[i].url;
    const response = responseMap[i].response;
    mock
      .onRequestTo(url)
      .respond(response);
  }
  return mock;
};

async function setup(t, locale, fileName) {
  const options = mocksWithInteractionCodeFlow.includes(fileName) ? optionsForInteractionCodeFlow : {};
  const widgetView = new PageObject(t);
  await widgetView.navigateToPage();
  await renderWidget({
    ...options,
    'language': locale
  });
}

const testEnglishLeaks = (mockIdxResponse, fileName, locale) => {
  test.requestHooks(mockIdxResponse)(`${fileName} should not have english leaks`, async t => {
    await setup(t, locale, fileName);
    const viewTextExists = await Selector('#okta-sign-in').exists;
    //Use innerText to avoid including hidden elements
    let viewText = viewTextExists && await Selector('#okta-sign-in').innerText;
    viewText = viewText && viewText.split('\n').join(' ');

    const noTranslationContentExists = await Selector('.no-translate').exists;
    let noTranslationContent = [];
    if (noTranslationContentExists) {
      //build array of noTranslationContent
      const noTranslateElems = await Selector('.no-translate').count;
      for (var i = 0; i < noTranslateElems; i++) {
        const noTranslateContent = await Selector('.no-translate').nth(i).textContent;
        noTranslationContent.push(noTranslateContent);
      }
    }
    await assertNoEnglishLeaks(fileName, viewText, noTranslationContent);
  });
};

const runTest = (mockData) => {
  for (let i = 0; i < mockData.length; i++) {
    const fileName = mockData[i];
    const filePath = `${mocksFolder}/${fileName}`;
    // start test
    testEnglishLeaks(setUpResponse(filePath), fileName, 'ok-PL');
  }
};

const mockData = parseMockData();
runTest(mockData);
