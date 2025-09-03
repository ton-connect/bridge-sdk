import nacl from 'tweetnacl';
import blake from 'blakejs';

function generateNonce(pk1: Uint8Array, pk2: Uint8Array) {
    const state = blake.blake2bInit(nacl.box.nonceLength);
    blake.blake2bUpdate(state, pk1);
    blake.blake2bUpdate(state, pk2);
    return blake.blake2bFinal(state);
}

export function openAnonymous(encrypted: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array) {
    const ephemeralPublicKey = encrypted.subarray(0, nacl.box.publicKeyLength);
    const nonce = generateNonce(ephemeralPublicKey, publicKey);

    const boxData = encrypted.subarray(nacl.box.publicKeyLength);
    return nacl.box.open(boxData, nonce, ephemeralPublicKey, secretKey);
}
