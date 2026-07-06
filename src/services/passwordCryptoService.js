const crypto = require('crypto');

const PASSWORD_TRANSPORT_ALGORITHM = 'RSA-OAEP-256+A256GCM';

const normalizePem = (value = '') => String(value || '').replace(/\\n/g, '\n').trim();

class PasswordCryptoService {
  constructor() {
    const configuredPrivateKey = normalizePem(process.env.PASSWORD_ENCRYPTION_PRIVATE_KEY);
    const configuredPublicKey = normalizePem(process.env.PASSWORD_ENCRYPTION_PUBLIC_KEY);

    if (configuredPrivateKey && configuredPublicKey) {
      this.privateKey = configuredPrivateKey;
      this.publicKey = configuredPublicKey;
    } else {
      const keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      this.privateKey = keyPair.privateKey;
      this.publicKey = keyPair.publicKey;
    }

    this.keyId = crypto
      .createHash('sha256')
      .update(this.publicKey)
      .digest('hex')
      .slice(0, 16);
  }

  publicDescriptor() {
    return {
      algorithm: PASSWORD_TRANSPORT_ALGORITHM,
      keyId: this.keyId,
      publicKey: this.publicKey
    };
  }

  decryptPassword(encryptedPassword) {
    if (!encryptedPassword || typeof encryptedPassword !== 'object') {
      throw new Error('Missing encrypted password payload');
    }

    if (encryptedPassword.algorithm !== PASSWORD_TRANSPORT_ALGORITHM) {
      throw new Error('Unsupported password encryption algorithm');
    }

    if (encryptedPassword.keyId && encryptedPassword.keyId !== this.keyId) {
      throw new Error('Password encryption key is no longer active');
    }

    const encryptedKey = this.decodeBase64(encryptedPassword.encryptedKey);
    const iv = this.decodeBase64(encryptedPassword.iv);
    const encryptedValue = this.decodeBase64(encryptedPassword.ciphertext);

    if (iv.length !== 12 || encryptedValue.length <= 16) {
      throw new Error('Invalid encrypted password payload');
    }

    const aesKey = crypto.privateDecrypt({
      key: this.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    }, encryptedKey);

    if (aesKey.length !== 32) {
      throw new Error('Invalid password encryption key length');
    }

    const authTag = encryptedValue.subarray(encryptedValue.length - 16);
    const ciphertext = encryptedValue.subarray(0, encryptedValue.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  }

  decodeBase64(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new Error('Invalid encrypted password payload');
    }
    return Buffer.from(normalized, 'base64');
  }
}

module.exports = new PasswordCryptoService();
module.exports.PASSWORD_TRANSPORT_ALGORITHM = PASSWORD_TRANSPORT_ALGORITHM;
