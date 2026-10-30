import test from 'node:test';
import assert from 'node:assert/strict';
import {isExplicitUploadExpiry} from '../scripts/staging-verification-responses.mjs';

test('hosted signed upload expiry requires an explicit expiry error, not a generic denial',()=>{
  for(const status of [400,403]){
    assert.equal(isExplicitUploadExpiry(status,'<Error><Code>ExpiredToken</Code><Message>Request has expired.</Message></Error>'),true);
    assert.equal(isExplicitUploadExpiry(status,'<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'),true);
    assert.equal(isExplicitUploadExpiry(status,'<Error><Code>AccessDenied</Code><Message>Permission denied</Message></Error>'),false);
    assert.equal(isExplicitUploadExpiry(status,'<Error><Code>InvalidArgument</Code><Message>Invalid size</Message></Error>'),false);
  }
});
test('successful uploads, unavailable services and malformed responses never satisfy expiry verification',()=>{
  const expired='<Error><Code>RequestExpired</Code></Error>';
  for(const status of [200,201,401,404,500,503])assert.equal(isExplicitUploadExpiry(status,expired),false);
  for(const body of ['','not XML','<Error>','<html>Request has expired</html>','<Result><Code>ExpiredToken</Code></Result>'])assert.equal(isExplicitUploadExpiry(400,body),false);
});
