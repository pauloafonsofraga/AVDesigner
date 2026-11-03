// Shared public profile text only; safe in a minimal serverless function.
export function publicDisplayName(metadata={}) {
  for(const key of ['display_name','full_name','name']) {
    const name=typeof metadata?.[key]==='string'?metadata[key].trim():'';
    if(name && name.length<=100 && !/[@\x00-\x1f\x7f]/.test(name))return name;
  }
  return 'WireNexus contributor';
}

// JSONB can reorder object keys. Keep v1 signatures stable across persistence.
export const attributionClaimText=claims=>JSON.stringify({digest:claims.digest,creatorId:claims.creatorId,displayName:claims.displayName,createdAt:claims.createdAt});
