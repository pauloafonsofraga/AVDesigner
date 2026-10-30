import {DOMParser} from '@xmldom/xmldom';

export function isExplicitUploadExpiry(status,body) {
  if(![400,403].includes(status))return false;
  try {
    const document=new DOMParser({onError:()=>{throw Error('Invalid XML');}}).parseFromString(body,'text/xml');
    if(document.documentElement?.tagName!=='Error')return false;
    const code=document.getElementsByTagName('Code')[0]?.textContent;
    const message=document.getElementsByTagName('Message')[0]?.textContent||'';
    return ['ExpiredToken','RequestExpired'].includes(code)||/request has expired/i.test(message);
  }catch{return false;}
}
