import hdkey from 'hdkey'
import ecc from 'eosjs-ecc'
import wif from 'wif'
import { Buffer } from 'safe-buffer'
import eos from 'eosjs'
import bip39 from 'bip39'
import assert from 'assert'
import secp256k1 from 'secp256k1'
import { toEOSAmount, getExpiration } from './util'

class HDNode {
  constructor ({ seed, extendedKey, privateKey, chainId }) {
    if (seed) {
      this._seed = seed
      this._node = hdkey.fromMasterSeed(Buffer(seed, 'hex'))
    } else if (extendedKey) {
      this._seed = null
      this._node = hdkey.fromExtendedKey(extendedKey)
    } else {
      assert.equal(privateKey.length, 32, 'Private key must be 32 bytes.')
      assert(secp256k1.privateKeyVerify(privateKey), 'Invalid private key')
      this._seed = null
      this._node = {
        _publicKey: secp256k1.publicKeyCreate(privateKey, true),
        _privateKey: privateKey
      }
    }
    this._chainId = chainId || 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
  }

  static generateMnemonic () {
    return bip39.generateMnemonic()
  }

  static fromMnemonic (mnemonic, chainId) {
    const seed = bip39.mnemonicToSeedHex(mnemonic)
    return new this({ seed, chainId })
  }

  static fromMasterSeed (seed, chainId) {
    return new this({ seed, chainId })
  }

  static fromExtendedKey (extendedKey, chainId) {
    return new this({ extendedKey, chainId })
  }

  static fromPrivateKey (key, chainId) {
    const privateKey = wif.decode(key).privateKey
    return new this({ privateKey, chainId })
  }

  derivePath (path) {
    assert(this._node.derive, 'can not derive when generate from private / public key')
    this._node = this._node.derive(path)
    const extendedKey = this._node.privateExtendedKey || this._node.publicExtendedKey
    return new HDNode({ extendedKey, chainId: this._chainId })
  }

  deriveChild (index) {
    assert(this._node.deriveChild, 'can not derive when generate from private / public key')
    this._node = this._node.deriveChild(index)
    const extendedKey = this._node.privateExtendedKey || this._node.publicExtendedKey
    return new HDNode({ extendedKey, chainId: this._chainId })
  }

  getPrivateExtendedKey () {
    assert(this._node.privateExtendedKey, 'can not get xpriv when generate from private / public key')
    return this._node.privateExtendedKey
  }

  getPublicExtendedKey () {
    assert(this._node.publicExtendedKey, 'can not get xpub when generate from private / public key')
    return this._node.publicExtendedKey
  }

  getPublicKey () {
    return ecc.PublicKey(this._node._publicKey).toString()
  }

  getPrivateKey () {
    return wif.encode(128, this._node._privateKey, false)
  }

  getInstance (expiration, refBlockNum, refBlockPrefix) {
    const headers = {
      expiration: getExpiration(expiration),
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix
    }
    const privateKey = this.getPrivateKey()
    return eos({
      keyProvider: privateKey,
      transactionHeaders: (expireInSeconds, callback) => callback(null, headers),
      broadcast: false,
      sign: true,
      chainId: this._chainId,
      httpEndpoint: null
    })
  }

  async generateTransaction ({
    from,
    to,
    amount,
    memo,
    refBlockNum,
    refBlockPrefix,
    expiration,
    symbol
  }) {
    // offline mode eosjs
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const trx = await eosjsInstance.transfer(from, to, toEOSAmount(amount, symbol), memo)
    return trx
  }

  async registerAccount ({
    accountName,
    refBlockNum,
    refBlockPrefix,
    expiration,
    creator,
    stakeAmountCpu = 1000,
    stakeAmountNet = 1000,
    bytes = 4000,
    symbol,
    ownerKey,
    activeKey
  }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.newaccount({
        creator,
        name: accountName,
        owner: ownerKey || this.getPublicKey(),
        active: activeKey || this.getPublicKey()
      })
      tr.buyrambytes({
        payer: creator,
        receiver: accountName,
        // hardcode 4KB ram
        bytes
      })
      tr.delegatebw({
        from: creator,
        receiver: accountName,
        stake_net_quantity: toEOSAmount(stakeAmountNet, symbol),
        stake_cpu_quantity: toEOSAmount(stakeAmountCpu, symbol),
        transfer: 0
      })
    }, { broadcast: false, sign: true })
    return res
  }

  async delegate ({
    from,
    to,
    cpuAmount,
    netAmount,
    refBlockNum,
    refBlockPrefix,
    expiration,
    symbol
  }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.delegatebw({
        from,
        receiver: to,
        stake_net_quantity: toEOSAmount(netAmount, symbol),
        stake_cpu_quantity: toEOSAmount(cpuAmount, symbol),
        transfer: 0
      })
    }, { broadcast: false, sign: true })
    return res
  }

  async undelegate ({
    from,
    to,
    cpuAmount,
    netAmount,
    refBlockNum,
    refBlockPrefix,
    expiration,
    symbol
  }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.undelegatebw({
        from,
        receiver: to,
        unstake_net_quantity: toEOSAmount(netAmount, symbol),
        unstake_cpu_quantity: toEOSAmount(cpuAmount, symbol),
        transfer: 0
      })
    }, { broadcast: false, sign: true })
    return res
  }

  async vote ({ from, producers, refBlockNum, refBlockPrefix, expiration }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.voteproducer(from, '', producers)
    return res
  }

  async bidname ({ bidder, name, amount, refBlockNum, refBlockPrefix, expiration }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.bidname({
        bidder,
        newname: name,
        bid: toEOSAmount(amount)
      })
    })
    return res
  }

  async buyram ({ payer, receiver, bytes, expiration, refBlockNum, refBlockPrefix }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.buyrambytes({ payer, receiver, bytes })
    })
    return res
  }

  async sellram ({ account, bytes, expiration, refBlockNum, refBlockPrefix }) {
    const eosjsInstance = this.getInstance(expiration, refBlockNum, refBlockPrefix)
    const res = await eosjsInstance.transaction(tr => {
      tr.sellram({ account, bytes })
    })
    return res
  }
}

export default HDNode
