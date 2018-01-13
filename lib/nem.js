const nem = require("nem-library"),
  Observable = require('rxjs/Observable').Observable;

/******************************************************************************/

// 共通
const MODE = 'local'; // 例) local=ローカル開発 / production=本番
const ADDRESS = ''; // NEMアドレス
const PRIVATE_KEY = ''; // NEM秘密鍵
// マルチシグ
const MULTISIG_PUBLIC_KEY = ''; // マルチシグウォレットの公開鍵
const MULTISIG_PRIVATE_KEY = ''; // マルチシグウォレットの秘密鍵
// モザイク
const NAMESPACE = ''; // ネームスペース名
const MOSAIC = ''; // モザイク名

// NEM接続環境の指定
if (MODE === "production") {
  console.log("nem connection [MAIN_NET]");
  nem.NEMLibrary.bootstrap(nem.NetworkTypes.MAIN_NET);
} else {
  console.log("nem connection [TEST_NET]");
  nem.NEMLibrary.bootstrap(nem.NetworkTypes.TEST_NET);
}

const nemapi = {};

/******************************************************************************/
// toolパート

nemapi.tools = {};

if (MODE === "production") {
  // nem-library@0.11.0ではdefault設定だとlistenerが動かないので指定.何でだろ
  nemapi.tools.CONNECTION = [
    {
      domain: "alice6.nem.ninja"
    }
  ];
}

/**
  * 文字列のハイフンを削除します
  * @param str 文字列
  * @return ハイフン削除後の文字列
  */
nemapi.tools.nohyphen = (str) => {
  return str.replace(/-/g, '');
}

/**
  * NEMLibraryのAddressインスタンスを生成します
  * @param address NEMアドレス
  */
nemapi.tools.address = (address) => {
  return new nem.Address(address
    ? address
    : ADDRESS);
}

/**
 * メッセージインスタンスを作成します
 * @param message メッセージ文字列
 * @return NEMLibraryメッセージインスタンス
 */
nemapi.tools.message = (message) => {
  if (!message) {
    return nem.EmptyMessage;
  }
  return nem.PlainMessage.create(message);
};

/**
 * 暗号化文字列のメッセージインスタンスを作成します
 * @param message メッセージ
 * @param publicKey 宛先の公開鍵
 * @return NEMLibraryメッセージインスタンス
 */
nemapi.tools.encryptedMessage = (message, publicKey) => {
  if (!message) {
    return nem.EmptyMessage;
  }
  const recipientPublicAccount = nem.PublicAccount.createWithPublicKey(publicKey);
  const account = nem.Account.createWithPrivateKey(PRIVATE_KEY);
  return account.encryptMessage(message, recipientPublicAccount);
};

/**
 * NEMLibraryのトランザクション返却値を解析します(4パターン)
 *
 * 1. single transactino
 * 2. single mosaic transactino
 * 3. multisig transactino
 * 4. multisig mosaic transactino
 *
 * @param result nemapi.listener.confirmedTransaction.subscribeの引数
 * @return トランザクション簡易情報
 */
nemapi.tools.parseTransaction = (result) => {
  const t = {
    publicKey: null, // 送信元公開鍵
    address: null, // 送信元アドレス
    amount: 0, // xem数量
    fee: 0, // 手数料
    mosaics: [] // モザイク配列
  };

  // 共通
  t.publicKey = result.signer.publicKey;
  t.address = result.signer.address.value;

  // 個別
  if (result.type === 257) { // 通常のトランザクション
    t.fee = result.fee; // 手数料
    if (!result._mosaics) { // XEMトランザクション
      t.amount = result._xem.amount;
    } else { // モザイクトランザクション
      result._mosaics.forEach(e => {
        if (e.mosaicId.namespaceId === "nem") {
          t.amount = e.quantity;
        } else {
          t.mosaics.push(e);
        }
      });
    }

  } else if (result.type === 4100) { // マルチシグトランザクション
    t.fee = result.fee; // マルチシグ手数料
    t.fee += result.otherTransaction.fee; // 手数料

    if (!result._mosaics) { // XEMトランザクション
      t.amount = result.otherTransaction._xem.amount;
    } else { // モザイクトランザクション
      result._mosaics.forEach(e => {
        if (e.mosaicId.namespaceId === "nem") {
          t.amount = e.quantity;
        } else {
          t.mosaics.push(e);
        }
      });
    }

  } else { // 想定外
    console.log("not supported transactino type", result);
  }
  return t;
};

/**
 * トランザクションを送信します
 * @param privateKey 送信元秘密鍵
 * @param transaction NEMLibraryのトランザクションインスタンス
 * @return Observableインスタンス
 */
nemapi.tools.sendTransaction = (privateKey, transaction) => {
  const account = nem.Account.createWithPrivateKey(privateKey);
  const signedTransaction = account.signTransaction(transaction);
  return new nem.TransactionHttp().announceTransaction(signedTransaction);
};

/**
  * Observable情報の中身を表示します
  * @param observable Observableインスタンス
  */
nemapi.tools.debug = (observable) => {
  observable.subscribe(_ => {
    console.log(_);
  });
}

/******************************************************************************/
// accontパート

/**
 * アカウント情報を取得します
 * @param _address アドレス
 * @return Observableインスタンス
 */
nemapi.getAccountInfo = (_address) => {
  const accountHttp = new nem.AccountHttp();
  return accountHttp.getFromAddress(nemapi.tools.address(_address));
};

/**
 * 公開鍵をもとにアカウント情報を取得します
 * @param publicKey 公開鍵
 * @return Observableインスタンス
 */
nemapi.getAccountInfoByPublicKey = (publicKey) => {
  const accountHttp = new nem.AccountHttp();
  return accountHttp.getFromPublicKey(publicKey);
};

/**
 * アカウントの詳細情報を取得します
 * @param _address アドレス
 * @return Observableインスタンス
 */
nemapi.getAccountDetailInfo = (_address) => {
  const address = new nem.Address(nemapi.tools.address(_address));
  const accountOwnedMosaics = new nem.AccountOwnedMosaicsService(new nem.AccountHttp(), new nem.MosaicHttp());
  return accountOwnedMosaics.fromAddress(address);
};

/**
 * アドレスのトランザクション情報を取得します(最大25件)
 * `Pageable.nextPage();`を呼び出すことで次のページが取得できます
 *
 * @param _address アドレス
 * @return Pageableインスタンス
 */
nemapi.allTransactions = (_address) => {
  const accountHttp = new nem.AccountHttp();
  return accountHttp.allTransactions(nemapi.tools.address(_address))
};

/******************************************************************************/
// transactionパート

/**
 * トランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message(任意) 送信するメッセージ
 * @return Observableインスタンス
 */
nemapi.sendTransaction = (to, size, message) => {
  return nemapi.sendLowTransaction(to, size, nemapi.tools.message(message));
};

/**
 * 暗号化メッセージを含むトランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message 送信するメッセージ
 * @param publicKey 宛先の公開鍵
 * @return Observableインスタンス
 */
nemapi.sendEncryptedTransaction = (to, size, message, publicKey) => {
  return nemapi.sendLowTransaction(to, size, nemapi.tools.encryptedMessage(message, publicKey));
};

/**
 * トランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message NEMLibraryメッセージインスタンス
 */
nemapi.sendLowTransaction = (to, size, message) => {
  const transferTransaction = nem.TransferTransaction.create(nem.TimeWindow.createWithDeadline(), //
      new nem.Address(to), new nem.XEM(size), message);
  return nemapi.tools.sendTransaction(PRIVATE_KEY, transferTransaction);
};

// multisig transactionパート
nemapi.multisig = {};

/**
 * マルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message(任意) 送信するメッセージ
 * @return Observableインスタンス
 */
nemapi.multisig.sendTransaction = (to, size, message) => {
  return nemapi.multisig.sendLowTransaction(to, size, nemapi.tools.message(message));
};

/**
 * 暗号化メッセージを含むマルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message 送信するメッセージ
 * @param publicKey 宛先の公開鍵
 * @return Observableインスタンス
 */
nemapi.multisig.sendEncryptedTransaction = (to, size, message, publicKey) => {
  return nemapi.multisig.sendLowTransaction(to, size, nemapi.tools.encryptedMessage(message, publicKey));
};

/**
 * マルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @return Observableインスタンス
 */
nemapi.multisig.sendLowTransaction = (to, size, message) => {
  const transferTransaction = nem.TransferTransaction.create( //
      nem.TimeWindow.createWithDeadline(), //
      new nem.Address(to), //
      new nem.XEM(size), //
      message);
  const multisigTransaction = nem.MultisigTransaction.create( //
      nem.TimeWindow.createWithDeadline(), //
      transferTransaction, //
      nem.PublicAccount.createWithPublicKey(MULTISIG_PUBLIC_KEY));

  return nemapi.tools.sendTransaction(MULTISIG_PRIVATE_KEY, multisigTransaction);
};

/******************************************************************************/
// mosaic transactionパート

nemapi.mosaic = {};

/**
  * NEMLibraryのMosaicIdインスタンスを取得します
  * @param namespace ネームスペース
  * @param mosaic モザイク名
  * @return MosaicIdインスタンス
  */
nemapi.mosaic.MosaicId = (namespace, mosaic) => {
  return new nem.MosaicId(namespace || NAMESPACE, mosaic || MOSAIC);
};

/**
  * モザイク情報を取得します
  * @namespace ネームスペース
  * @return Observableインスタンス
  */
nemapi.mosaic.getInfo = (namespace) => {
  namespace = namespace || NAMESPACE;
  const mosaicHttp = new nem.MosaicHttp();
  return mosaicHttp.getAllMosaicsGivenNamespace(namespace);
};

/**
 * モザイクのトランザクションを送信します
 * @param to 宛先アドレス
 * @param size 送信するNEMのサイズ
 * @param message(任意) 送信するメッセージ
 * @return Observableインスタンス
 */
nemapi.mosaic.sendTransaction = (to, quantity, message) => {
  return nemapi.mosaic.sendLowTransaction(to, quantity, nemapi.tools.message(message));
};

/**
 * 暗号化メッセージを含むモザイクのトランザクションを送信します
 * @param to 宛先アドレス
 * @param quantity 送信するNEMのサイズ
 * @param message 送信するメッセージ
 * @param publicKey 宛先の公開鍵
 * @return Observableインスタンス
 */
nemapi.mosaic.sendEncryptedTransaction = (to, quantity, message, publicKey) => {
  return nemapi.mosaic.sendLowTransaction(to, quantity, nemapi.tools.encryptedMessage(message, publicKey));
};

/**
 * モザイクのトランザクションを送信します
 * @param to 宛先アドレス
 * @param quantity 送信するNEMのサイズ
 * @param message NEMLibraryメッセージインスタンス
 * @return Observableインスタンス
 */
nemapi.mosaic.sendLowTransaction = (to, quantity, message) => {
  const transactionHttp = new nem.TransactionHttp();
  const mosaicHttp = new nem.MosaicHttp();
  const account = nem.Account.createWithPrivateKey(PRIVATE_KEY);

  Observable.from([
    {
      mosaic: nemapi.mosaic.MosaicId(),
      quantity: quantity
    }
  ]).flatMap(_ => mosaicHttp.getMosaicTransferableWithAmount(_.mosaic, _.quantity)). //
  toArray(). //
  map(mosaics => nem.TransferTransaction.createWithMosaics( //
      nem.TimeWindow.createWithDeadline(), //
      new nem.Address(to), //
      mosaics, //
      message)). //
  map(transaction => account.signTransaction(transaction)). //
  return flatMap(signedTransaction => transactionHttp.announceTransaction(signedTransaction));
};

// mosaic multisig transactionパート
nemapi.mosaic.multisig = {};

/**
 * モザイクのマルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param quantity 送信するモザイクサイズ
 * @param message(任意) 送信するメッセージ
 * @return Observableインスタンス
 */
nemapi.mosaic.multisig.sendTransaction = (to, quantity, message) => {
  nemapi.mosaic.multisig.sendLowTransaction(to, quantity, nemapi.tools.message(message));
};

/**
 * 暗号化メッセージを含むモザイクのマルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param quantity 送信するモザイクサイズ
 * @param message 送信するメッセージ
 * @param publicKey 宛先の公開鍵
 * @return Observableインスタンス
 */
nemapi.mosaic.multisig.sendEncryptedTransaction = (to, quantity, message, publicKey) => {
  nemapi.mosaic.multisig.sendLowTransaction(to, quantity, nemapi.tools.encryptedMessage(message, publicKey));
};

/**
 * モザイクのマルチシグトランザクションを送信します
 * @param to 宛先アドレス
 * @param quantity 送信するモザイクサイズ
 * @param message NEMLibraryメッセージインスタンス
 * @return Observableインスタンス
 */
nemapi.mosaic.multisig.sendLowTransaction = (to, quantity, message) => {
  const transactionHttp = new nem.TransactionHttp();
  const mosaicHttp = new nem.MosaicHttp();
  const account = nem.Account.createWithPrivateKey(PRIVATE_KEY);

  Observable.from([
    {
      mosaic: nemapi.mosaic.MosaicId(),
      quantity: quantity
    }
  ]).flatMap(_ => mosaicHttp.getMosaicTransferableWithAmount(_.mosaic, _.quantity)). //
  toArray(). //
  map(mosaics => nem.TransferTransaction.createWithMosaics( //
      nem.TimeWindow.createWithDeadline(), //
      new nem.Address(to), //
      mosaics, //
      message)). //
  map(transferTransaction => nem.MultisigTransaction.create( //
      nem.TimeWindow.createWithDeadline(), //
      transferTransaction, //
      nem.PublicAccount.createWithPublicKey(MULTISIG_PUBLIC_KEY))). //
  map(multisigTransaction => account.signTransaction(multisigTransaction)). //
  flatMap(signedTransaction => transactionHttp.announceTransaction(signedTransaction)). //
  subscribe(nemAnnounceResult => {
    console.log(nemAnnounceResult);
  });

};

/******************************************************************************/
// listenerパート

nemapi.listener = {};

/**
  * アカウント情報をリッスンします
  * @param _address(任意) アドレス
  * @return Observableインスタンス
  */
nemapi.listener.accountListener = (_address) => {
  return new nem.AccountListener().given(nemapi.tools.address());
};

/**
  * ブロック生成情報をリッスンします
  * @return Observableインスタンス
  */
nemapi.listener.blockchainNewBlock = () => {
  return new nem.BlockchainListener().newBlock();
};

/**
  * ブロック高情報をリッスンします
  * @return Observableインスタンス
  */
nemapi.listener.blockchainNewHeight = () => {
  return new nem.BlockchainListener().newHeight();
};

/**
  * 承認前のトランザクションをリッスンします
  * @param _address(任意) アドレス
  * @return Observableインスタンス
  */
nemapi.listener.unconfirmedTransaction = (_address) => {
  return new nem.UnconfirmedTransactionListener().given(nemapi.tools.address(_address));
};

/**
  * 承認済みのトランザクションをリッスンします
  * @param _address(任意) アドレス
  * @return Observableインスタンス
  */
nemapi.listener.confirmedTransaction = (_address) => {
  return new nem.ConfirmedTransactionListener(nemapi.tools.CONNECTION).given(nemapi.tools.address(_address));
  // 例)
  // confirmedTransactionListener.subscribe(_ => {
  //  const result = nemapi.tools.parseTransaction(_);
  //  console.log(result);
  // });
};

/******************************************************************************/
module.exports = nemapi;
