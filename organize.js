#!/usr/bin/env node
/*
 * organize.js - puts "flat" uploaded files back into their real folders.
 *
 * WHY: uploading from a phone into ONE place is easier than folder by folder.
 * Files from sub-folders are uploaded with the folder in the name:
 *      lib__server.js            ->  lib/server.js
 *      public__css__style.css    ->  public/css/style.css
 * Files that belong in the main folder keep their normal name.
 *
 * It also repairs phone/browser duplicate names. If it finds  "server (1).js",
 * "server (2).js", "server-1.js" ... it keeps the copy whose content matches the
 * real file (checked with a fingerprint), puts it under the proper name, deletes
 * identical leftovers, and moves any different leftovers to the folder _duplicates
 * (nothing is thrown away blindly).
 *
 * RUN:  node organize.js          (arrange now)
 *       node organize.js --dry    (only show what would happen)
 * It also runs automatically on "npm start" / "npm run build" / when server.js starts,
 * and does nothing when everything is already in place.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const KEEP_DIRS = ['public/files', 'public/receipts', 'public/uploads'];
const MANIFEST = {
 "FIXES_V3.md": "86efb328f4da7cbc9a70a746ae5efb0c31cbf6d2475b0c478ce0ef9b639efe57",
 "FIXES_V4.md": "55c18612d0b46c31f91f078c0e5d55688c7ae820acafd65ea2ef8baae8c062a6",
 "HOTFIX_NOTES.md": "f2a6e7d53a707dd01a1e96ad4c56742e1489a54dd517e2b29d02807508a6c93e",
 "MARVINUMS-REDESIGN-NOTES.md": "9c90d54abaa2ddde88233c32d2e40ac44e0a7652a0d00cb0f5dd7ba6b0c04675",
 "NOVASOLUTION_RENDER_SETUP.md": "1f61a3e014fd7837d60b6f38d533919ff06383454ac824bce150bdef3bb4dc61",
 "README.md": "c9717ab46d7e187ed9f790d88011ecd55d4c5d72a7888c6ac158b654b542f51b",
 "Readme.md": "aa72a2da5cb6387d1434d8b68595147caa4a3b498c9b47eac9e64cfd9f2a0f86",
 "TUTORIALS_FIX.md": "64941c71a48382a759d29a1a0eedd460b29353f6916972b2791b9dfe88f07e5a",
 "UPDATES_SUMMARY.md": "b26aa3a77308e64d31879f2392e5092d7d712b193ef7c145a428ee8237f18257",
 "docs/API.md": "b616b68292e621676ce0c267c6adda8b88b2e87e2b2d4b9943e13af65c428d23",
 "docs/BOOST_API.md": "ca93aa2a968ff42d38573d5ee35416fcbc0495c52a092d196eb2595e1b87e68e",
 "docs/BOOST_SETUP.md": "d4c5f0dd2607173e78aa55aa8c75f321f508ad4bceb95c5a4e6c594c15422cf2",
 "docs/CLONE-AND-SETUP.md": "8ac2c44299511a46a3c6d0f15df57f24f32f98ce3b28e0ab927c8a66e7a315c7",
 "docs/MARKETPLACE2_SETUP.md": "5f10ff7c9dc8d55b87f2743d074cf065afcb3c6bd6c57ec6e1dfb0cdd88eee87",
 "docs/PAYSTACK_SETUP.md": "22a6b34a8afbdd96a2920f89dfc6d24991f471069b1b346198eea18270f8c9b8",
 "lib/boost.js": "ad2013b5c5d1363f67bbb257e5f668011f0873da9c7be85ef69c9e837fc6d9f8",
 "lib/boost2.js": "bfd14a8a9044effce353149330b24d58e08d514faea266bf55d41b7ac4304f1c",
 "lib/campaigns.js": "4f0f4d2510fe37a3e84602df3b29529e5a8ff83e4cd168aac79445e139dad829",
 "lib/countries.data.json": "06cd7846322f81ac6286670c089f16c31dae45e662b96949de530417902574b5",
 "lib/countries.js": "b2fbe58b6c644bdb4bf4ffb08da2d4daf092710bc2a3bb5d248ca4a661ed1b14",
 "lib/engagement.js": "3ec63335ca37c9b7e361117ef607561cccadc1339996ab7d12894e581b852ab4",
 "lib/flw-methods.js": "177c050eac6e305aef04da9ec3da8370bd2b2584dac2e4f35af61a8cac180399",
 "lib/fx.js": "11f49f561d461f0f6d41f72df1a15ef77c25bf59f83f577da11a015b5af9a3ea",
 "lib/geo.js": "0820a0caffd4c798c2bbf48f4ee6fcb7bb002e5a7f49184615f8687f98aceca1",
 "lib/global-payments.js": "6f11c565ec9d70c5e1dea44a2e82e17840a5f2f92fea5f31c16004a92ac4fad5",
 "lib/mailer.js": "9e074a607f80a099f614936495fade81ea37cd3fa14b6f91841ba97012a57c28",
 "lib/market2.js": "e5256140e40675dfe7fc76bc5b001a5fc4243de503b73ed4040b9fd85eccb150",
 "lib/market3.js": "bfdb73365f36899f73e22a7291b9ee6e34fc28730ab0f117ff82e838d04c613c",
 "lib/minipdf.js": "a40d09e5d238c36077301c9092248dbb568d554d751b383f4a26fc625c50d27d",
 "lib/platform.js": "66dae8224c1035cbbeec50233be3c2e61a323648d59edf0d56b1c5945a911096",
 "lib/restock-notify.js": "aca5a6ea0dca960d3414af762816b5387da19a86850585b23c10deb9d743f2e1",
 "lib/settings.js": "e742a3d3db8b578f0afd0f6d5eb264a572ef189fbe452808a7b6705e848453b6",
 "lib/tutorials.js": "e092ef3c12d421852c824567a03fd9e19c7abd9d35dc2a4653512809c6a86392",
 "lib/welcomepopup.js": "434dae2616e7dcd3eaca24e2e03196aade0e983f6373a20103768cbc4f19d9ae",
 "package-lock.json": "fdc80e9d166ae4018777f80edb30fcb727689b1d28caaeb8850ea65c343dab4e",
 "package.json": "3f663c472a7de306956dcbf8532d3a08df1efae27d8f621bfce36707f702ed92",
 "public/admin.html": "cb6c1df3d2823538aeacf26fc2fd34bb1663c496e5458dd610e7520e27dde62c",
 "public/auth-keeper.js": "0a988594332169c79583abd23c072e0f49fbf35bc16d80a124c0ae8b07f9e89f",
 "public/back-button.js": "6ea86bfddbe3f4455f21ee19521b48f567eef9d719cad09b53417727bbdea8a2",
 "public/boost-all-services.html": "8354ebe750d9023ebcabfd96ac122747667a335185a04c3625e5416616a7c10d",
 "public/boost-history.html": "b0304da77d5ec7b01d7e949387e172222fb7981126c30951c26bce2fc7f5c8ac",
 "public/boost-history.js": "0e8d80afee59c29e3f60f70d527296b87aa5f8368a0fd9ddd7b7dd3ed0c769cc",
 "public/boost-services.html": "fb8d383265321da47389904811754ea8f09ed806f3807758e21e4fc5b8971fbd",
 "public/boost.html": "ec43b33efbe7f5b3aa0e97c02496762aa9e9212f0a297316082ba7e8fd844d88",
 "public/boost.js": "016f5b5f5e5ca7b872d6da4dd8e0157aa05569f7d4ad1a2cc6f8ea950d1882e9",
 "public/boost1.html": "e64366c7940aee6c3603662e612e6a54f642bb637ab70442d55301e36f343490",
 "public/boost2.html": "c93496c1fd6f878cd953628c953e2a590cec2dfd028a83696798e34fc68e9ecd",
 "public/buy-number.html": "de84a48233a25210e87420048626dcfd511600d1d8713fe561da51631666a2dd",
 "public/buy-number.js": "0f32a0f2d97ef872cd0e2e33513e850bb0272f409764a92c15f1d46b2da86cfa",
 "public/css/admin-pro.css": "176e699a41a59f74934686d59ff8e9a2c0889c47cd44657197c88d2314d2cbe4",
 "public/css/announce.css": "049e05c0cce40b49d94692a890a4a36d44770553cb3ae3334433335addf85a49",
 "public/css/app-shell.css": "87fd21bdcd5b6995a7a93cc17a5661fcbebfa46dbdf1aae32c1958e59e56febb",
 "public/css/app-structure.css": "75e6d54274c4196f375cdffa8917bb45119dca3b4798cd4f9e72e97adf419f7c",
 "public/css/boost-redesign.css": "bb64f964a7adf5972f1e17baec9bb553cd581bb989bce0ee1fb7f836ebadec8b",
 "public/css/boost-wizard.css": "f53b83178b4d6003358e243ea1556e12c35780247ef956bbd6adef02221958d7",
 "public/css/boost.css": "aa0f7359a8b2b82c29e62fa1c2c9ec88e7560190a00ddc39994c41b499461a4e",
 "public/css/fix-pack.css": "e90f61013c43b46d75e9ccaed292ef1b6a93d7f3658911cf4cda8f22f9e15652",
 "public/css/glass-ui.css": "c56c1b9289714a08bc8b4584b9b94ce72648aa815afa3d737ef03e3c6cea3f08",
 "public/css/layout-polish.css": "293860356f8f371bd0cea99b286b30a6510910bf6215deaf628db40dbd104727",
 "public/css/marketplace-standard.css": "22bd63c8d11a2d43411b7e1274385c701e8ac867f7890e43306dd2b6b2cd0e17",
 "public/css/marvel-nums-mobile-polish.css": "ccae026d0d241d005f8fdbd7aec1a38756d63d2614fce2714f5a5271ee6559d1",
 "public/css/marvinums-brand.css": "80c5780a356b0520d4c690e033b3b07f9a66250865593d4999fb4a0d94badc24",
 "public/css/mobile-fix.css": "fd213ee0d3485cf7d40b4b2305d12539a5993ac598b31c2836c953766c3db3c3",
 "public/css/numbers-redesign.css": "b23842f77de63135ba78a155e1bc83103b2ce94d2303a2cd57c755b4bf903f09",
 "public/css/pro-polish.css": "85bb19689fd476e328d2d67e61a4b2d5c31f39b3a99594eaf012240e21e6c105",
 "public/css/redesign.css": "17e127e35fd349a7199eff0bd5488e2583534efb468f3b01da2230af147e7c0f",
 "public/dashboard.html": "f42027bdd4ec7fd4605f301d0ed07f2ff1925d82cb265f17602842384cd29dd8",
 "public/data-bill.html": "4873be5be0873e1c41e570fb263db14774052ca21450847b38d8db00b27da2e4",
 "public/deposit.html": "3a5b929adaaeddb44704b14ad99a6faaeddb8debf129b4993841c97aa63a68ff",
 "public/favicon.ico.HEIC": "edcd84a81353f3cc38f32462f0757e654af9d37ca1f791af65c8a6823d2f9624",
 "public/favicon.png": "8eee11d3e75ad074ebf3539bf3cc3a6f0931bc227d130705296d028ff0fe0d73",
 "public/game.js": "800b7eafc7770c1959c9623ad6f04c617740a954ad905dd61069efb127700a19",
 "public/img/marvinums-bg-phone.webp": "fcb1db31f0e7339c5743e82d12c08a8c7e473b0348e8b420c17612467549f42a",
 "public/img/marvinums-bg-social.webp": "7a4a75c06b0f773643f8a7ed8c0f2c1a680db4771e037348126d1a81534f01e8",
 "public/img/marvinums-bg-speed.webp": "b1a03760e97c306605310365d5f9957fada9b72772ad9f73faf7d8cfeb2d2f51",
 "public/img/marvinums-logo.webp": "cd4d74922c4d0aff606699420993dd41d1f0d4eacebad48b9b4bb8b45fba5b1e",
 "public/index.html": "acfe033eb93048dd81bd981887ccb07e16e85aa767b41caf5859426b0d1685be",
 "public/js/announcements.js": "2d8a80aceae703aaf815203754060b1ce77558fc15fe02e2c9dbdc452b904dd4",
 "public/js/app-guide.js": "1a6db049ec221772f1287a70a594ee6cbaec0de97cca8c5afd505685aa55d69f",
 "public/js/app-shell.js": "2693c6609c6fb2d43eb6569a5322d8d76f40407d6047e46b3da7fce23336a606",
 "public/js/auth-keeper.js": "80b83893dbadb981ea20ef54c5280c1dceb70c16ad85c698d10db2cf6e7d8a95",
 "public/js/boost-history.js": "72b41fea031e3053e2630c876bc8e4a68c47b92b956c982348f2f6bd71921764",
 "public/js/boost-services.js": "5e2ee13da399af631095792ca102100d2aa11d901e5d3dddfac6a5386b68290c",
 "public/js/boost-wizard.js": "74b8c9544519e4fc0dafa7c20fe813714667f0c1ee927996581f732ca3789186",
 "public/js/boost.js": "7dd36a1494bc9583a47056c18aacfd644dfca9c225c1d9abb353d4c69e82af48",
 "public/js/country-select.js": "46731c9272c12e3a269cca7d915fdf9d5084641693d36f8601ca988bea9f172a",
 "public/js/dashboard.js": "5286c2f73d76ab812c233504ff33ce1ca6fb4419b7ac14b680669593c579169f",
 "public/js/dev-credit.js": "479b16a52e207ee9a703db1875e7a53b975554824b4e48e2394a501ecb5316af",
 "public/js/global-pay.js": "8fedd7b04100d68523ba99c0e17223ff9316f477af9e5faedbbf3a0852a125b4",
 "public/js/i18n.js": "ab62220185f9a01707be8f4e460397b70e4055f78951c22fed80fe26b38ea40a",
 "public/js/live-support.js": "ffde86669cd8e8f8a0773d6db0ea10b5733a58f7916bf1990bbe179f532d5363",
 "public/js/marvinums-brand.js": "c9b10981d97d226677b2f126348767892942e775e07f3541891de8a6573f8b5d",
 "public/js/money.js": "d8de0084cc92ad4457863e94879d78299d161823018c8fa393f090592a3ca4fb",
 "public/js/wallet.js": "610437ba26244de49d100dfa584cadd96ec1494c9e6a4cbef4174805d8f4a701",
 "public/kls-ui.js": "61c3fa08562c41b49dff33c16aa2d3ad9b3672adf8e9a23fa3522ca4157afbdd",
 "public/live-support.js": "bc18e5b6bb6369a20679ad20c8dd95cbc3487933cb2e3146cc77fb0bbe8e3ed6",
 "public/manifest.json": "776a8d123fa0ba3b71d29da38f67c9ced7f3d4268c8b1a06cb96fba109d7c6c4",
 "public/market2.js": "0dca74ad836249a640ac04d1196186b20cd664aff25b04740158a181cd83ee1f",
 "public/market3.js": "07183527fa185b759e90f151cf07ccc37421597295bda4f7d6acd3b4b5087c9b",
 "public/marketplace.html": "81852394fbda0679efa1405bd2a3b2caf100e699bc804eaa90f9e294c85ee417",
 "public/marketplace.js": "376006cfc9750aa40b2aae7acdaa68842a4413f8e5eb1ed371af3323ef149642",
 "public/marketplace2.html": "a2eb611cea2023ce19e39596077b36a2e15be14b1e27b363d8a63460d7aeedd5",
 "public/marketplace3.html": "273c57428027d21b2c27cce6be5c9cfcb5ea24f13d6df7a049e9ee9e57a3f2af",
 "public/number-history.html": "17da902eec3f24e864f8ede143a62de5623dee80b27229783093881bdc968297",
 "public/order-status.html": "cea73b22a3c3eb5cde8c4cab4eb65bfa36693fe49ed6e1b419f61092c7a7936f",
 "public/purchases.html": "91fec35aa13fd9b77e7072186448a8c1068425e84bd1b70d9913cf128abacce9",
 "public/referrals-fragment.html": "170821ccdff4501c1338f13877a4b357d1ebdd227e83476ddfbe790da988c684",
 "public/referrals.html": "022a78a24f7ae06cc1e1587ad7cbffa0f0edd4593718993e050af86807f775c1",
 "public/robots.txt": "236b754c33fe20a7d0f21875eca3ff66ba3de6d153c4a14dbef61fb62e35d456",
 "public/script.js": "05e22525872fce9122dd1094a6cbee9d3dacde28d53cf38d7fbec035905f7e97",
 "public/settings.html": "7cca1c3979e985ec27fb880c59519749dfb93b5434c02273ba4f83fe275366e4",
 "public/style.css": "5c23c8fbb5646607741ca6ccd29163548b9a5b7b2e6a62164f25123a02ece4ce",
 "public/support.html": "409293d762f72a77ec95a087049f1bfe0fc494ebf3422ccfcc0b134ed2b7053f",
 "public/theme.css": "268dd239fc277da65b02e25aab47f40edfc5779900387f1bbd81e2caad8f3970",
 "public/tools.html": "8497d6f583fdc749d6e775520dbb54e069c762c0d574df81963c653533b5574f",
 "public/tools.js": "e4ca6825a1f1ebb003ff61a597b418a0b6519693dd0cb908a820d10a6a1f5495",
 "public/transactions.html": "c997832874e6dc72412127bb43dfb81f358bfd884e46653273bcb101a0517ff2",
 "public/tutorials.html": "618bab5099cf9ae534459aff00acdefaf3341e0fda70cb1f3fbc1ab46cd1a87f",
 "public/virtual-account.html": "1be6bd9c9e7e950fe683042b2938e82c6dfd25d132978fae813a673c1c9618ae",
 "public/welcome-popup.js": "06a19acbaca511346514ac812a71e0771de3e6f5288ec3c4f0bd416deffd8390",
 "server.js": "fa0fc2efe014254ed5d131b2ee686314ef2ba4b67f444a0a04c7dd4f58bce564",
 "site.config.js": "f43f4a9f327a54856cc94cafc15929a2aa18cb492888e3c51bebb6826c4c302c"
};

// Files that were deleted from the project. A copy is removed only when its content matches the known
// old version; anything different is moved to _duplicates instead of being deleted.
const REMOVED = {"public/apidocs.html": ["ede2a9024f016fc0d749e76bb7f56ba8653f979b8751cb7dc9b2b90cdb67d205", "136a7d1a602075eeaa03d20b5781b5540e93558e7034f18b9c878632895f29b0"], "public/chat.html": ["900d1815fdb8b337fc042afffd210d247b996051fe958ff33d205272e1f9100b"], "public/game.html": ["1efc5b74230c257aec08667cb41a7ef3812c7c80367a47590b06e0b739a735a9"], "public/giveaway.html": ["c94c8ce6117d625042a8f50e27caa829076df9b7ddd5b2a81297e050d892b4d3"], "public/groups.html": ["13b99c95d066430bf154ced8da443a254dc216298799efa1a3963f8e80ef1e35"], "public/messages.html": ["c97a47572b8b8ce11e31a264114abbec2ac6009d5fd4ccc572def45ff45e8198"]};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flat = (dest) => dest.split('/').join('__');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// "name (1).ext", "name(2).ext", "name-3.ext" next to "name.ext"
function variantsIn(dir, name) {
  let list; try { list = fs.readdirSync(dir); } catch (e) { return []; }
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  const re = new RegExp('^' + esc(base) + '(\\s*\\(\\d+\\)|-\\d+)' + esc(ext) + '$');
  return list.filter((n) => re.test(n)).map((n) => path.join(dir, n));
}

function run(opts) {
  opts = opts || {};
  const dry = !!opts.dry;
  const log = opts.quiet ? function () {} : function () { console.log.apply(console, arguments); };
  const stats = { removed: 0, placed: 0, alreadyOk: 0, cleaned: 0, quarantined: 0, missing: [], warnings: [] };
  const dests = Object.keys(MANIFEST);
  const realFlat = new Set(dests.map(flat));
  const realDest = new Set(dests);

  const quarantine = (file) => {
    if (dry) return;
    const qd = path.join(ROOT, '_duplicates'); fs.mkdirSync(qd, { recursive: true });
    let t = path.join(qd, rel(file).split('/').join('__')), i = 1;
    while (fs.existsSync(t)) t = path.join(qd, i++ + '_' + rel(file).split('/').join('__'));
    fs.renameSync(file, t);
  };

  for (const dest of dests) {
    const want = MANIFEST[dest];
    const destAbs = path.join(ROOT, ...dest.split('/'));
    const destDir = path.dirname(destAbs);
    const isRoot = dest.indexOf('/') === -1;
    const cands = [];
    if (!isRoot) {
      const f = path.join(ROOT, flat(dest));
      if (fs.existsSync(f)) cands.push({ file: f, kind: 'flat' });
      for (const v of variantsIn(ROOT, flat(dest))) if (!realFlat.has(path.basename(v))) cands.push({ file: v, kind: 'flat-variant' });
    }
    if (fs.existsSync(destAbs)) cands.push({ file: destAbs, kind: 'dest' });
    for (const v of variantsIn(destDir, path.basename(dest))) if (!realDest.has(rel(v))) cands.push({ file: v, kind: 'dest-variant' });

    if (!cands.length) { stats.missing.push(dest); continue; }
    cands.forEach((c) => { c.hash = sha(c.file); });
    const pri = { 'flat': 0, 'dest': 1, 'flat-variant': 2, 'dest-variant': 3 };
    let chosen = cands.filter((c) => c.hash === want).sort((a, b) => pri[a.kind] - pri[b.kind])[0];
    if (!chosen) {
      chosen = cands.filter((c) => c.kind === 'flat')[0] || cands.filter((c) => c.kind === 'dest')[0] ||
        cands.slice().sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs)[0];
      if (cands.length > 1 || chosen.kind !== 'dest') stats.warnings.push('content differs from the expected version (kept anyway): ' + dest + '  <- ' + path.basename(chosen.file));
    }
    if (chosen.file !== destAbs) {
      // A wrong file already sits under the real name: keep a copy of it in _duplicates before replacing it.
      if (fs.existsSync(destAbs) && sha(destAbs) !== chosen.hash) {
        stats.quarantined++; log('moved to _duplicates (replaced by the matching copy): ' + dest);
        if (!dry) {
          const qd = path.join(ROOT, '_duplicates'); fs.mkdirSync(qd, { recursive: true });
          let t = path.join(qd, dest.split('/').join('__')), i = 1;
          while (fs.existsSync(t)) t = path.join(qd, i++ + '_' + dest.split('/').join('__'));
          fs.copyFileSync(destAbs, t);
        }
      }
      if (!dry) { fs.mkdirSync(destDir, { recursive: true }); fs.copyFileSync(chosen.file, destAbs); }
      stats.placed++; log('placed   ' + dest);
    } else stats.alreadyOk++;

    for (const c of cands) {
      if (c.file === destAbs) continue;
      if (c.hash === chosen.hash) { if (!dry) { try { fs.unlinkSync(c.file); } catch (e) {} } stats.cleaned++; }
      else { quarantine(c.file); stats.quarantined++; log('moved to _duplicates: ' + rel(c.file)); }
    }
  }
  for (const dest of Object.keys(REMOVED)) {
    const cands = [path.join(ROOT, flat(dest)), path.join(ROOT, ...dest.split('/'))]
      .concat(variantsIn(ROOT, flat(dest)), variantsIn(path.dirname(path.join(ROOT, ...dest.split('/'))), path.basename(dest)));
    cands.forEach((f) => {
      if (!fs.existsSync(f)) return;
      if ([].concat(REMOVED[dest]).indexOf(sha(f)) !== -1) { if (!dry) { try { fs.unlinkSync(f); } catch (e) {} } stats.removed++; log('removed obsolete ' + rel(f)); }
      else { quarantine(f); stats.quarantined++; log('moved to _duplicates: ' + rel(f)); }
    });
  }
  if (!dry) for (const d of KEEP_DIRS) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  log('\norganize: placed ' + stats.placed + ' | already in place ' + stats.alreadyOk + ' | duplicate copies removed ' + stats.cleaned + ' | different leftovers moved ' + stats.quarantined + (stats.removed ? ' | obsolete files removed ' + stats.removed : ''));
  if (stats.missing.length) log('NOT FOUND (upload these): ' + stats.missing.join(', '));
  stats.warnings.forEach((w) => log('WARNING: ' + w));
  return stats;
}

module.exports = { run };
if (require.main === module) {
  try { run({ dry: process.argv.indexOf('--dry') !== -1 }); } catch (e) { console.error('organize failed:', e.message); }
  process.exit(0);
}
