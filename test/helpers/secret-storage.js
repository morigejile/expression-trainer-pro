'use strict';
const crypto=require('node:crypto');

// Deterministic test account key, independent of the real machine's credential store.
function testSecretStorage() {
  const key=crypto.createHash('sha256').update('isolated-ipc-test-key').digest();
  return {isEncryptionAvailable:()=>true,
    encryptString(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},
    decryptString(value){const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
      decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');}};
}
module.exports={testSecretStorage};
