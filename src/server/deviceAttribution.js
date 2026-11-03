import {createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {attributionClaimText} from '../deviceAttributionIdentity.js';

export function signingConfiguration(env) {
  const keys=JSON.parse(env.WIRENEXUS_DEVICE_ATTRIBUTION_PUBLIC_KEYS || '[]');
  if(!Array.isArray(keys) || keys.some(k=>!k.id || k.jwk?.kty!=='EC' || k.jwk?.crv!=='P-256' || k.jwk.d))throw Error('Invalid public attribution key configuration.');
  let privateKey,active;
  if(env.WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK){
    privateKey=createPrivateKey({key:JSON.parse(env.WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK),format:'jwk'});
    const jwk=createPublicKey(privateKey).export({format:'jwk'});
    if(jwk.kty!=='EC' || jwk.crv!=='P-256')throw Error('Attribution requires P-256.');
    active={id:createHash('sha256').update(JSON.stringify(jwk)).digest('hex'),jwk};
    if(!keys.some(k=>k.id===active.id))keys.push(active);
  }
  return {keys,privateKey,active};
}
export function signDeviceAttribution(config,claims) {
  if(!config.privateKey)throw Error('Verified device attribution is not configured.');
  return {version:1,creatorId:claims.creatorId,displayName:claims.displayName,createdAt:claims.createdAt,
    proof:{version:1,algorithm:'ES256',keyId:config.active.id,claims,
      signature:sign('sha256',Buffer.from(attributionClaimText(claims)),{key:config.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')}};
}
