import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for secrets at rest:  v1.<keyId>.<iv>.<tag>.<ciphertext>
 * The key is supplied via APP_ENCRYPTION_KEY and never stored with the data.
 * Associated data binds a ciphertext to its owning record (e.g. connection ID)
 * so ciphertexts cannot be swapped between rows.
 */
export class SecretBox {
  constructor(
    private readonly key: Buffer,
    private readonly keyId: string,
  ) {
    if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  }

  seal(plaintext: string, associatedData: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      this.keyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  open(sealed: string, associatedData: string): string {
    const [version, keyId, iv, tag, ct] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
    if (keyId !== this.keyId)
      throw new Error(`Secret was sealed with key "${keyId}", which is not the active key`);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
