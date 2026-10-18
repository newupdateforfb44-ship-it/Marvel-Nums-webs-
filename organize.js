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
 "lib/server.js": "d0c59d4d085cde4cef94d294090e66309417030efda57a76dd87504d7a17e44b",
 "lib/server2.js": "de0c5166282ad85110abd01580ff7a6d89930a3632df32687e108b08bd403b60",
 "lib/settings.js": "e742a3d3db8b578f0afd0f6d5eb264a572ef189fbe452808a7b6705e848453b6",
 "lib/welcomepopup.js": "434dae2616e7dcd3eaca24e2e03196aade0e983f6373a20103768cbc4f19d9ae",
 "package-lock.json": "fdc80e9d166ae4018777f80edb30fcb727689b1d28caaeb8850ea65c343dab4e",
 "package.json": "3f663c472a7de306956dcbf8532d3a08df1efae27d8f621bfce36707f702ed92",
 "public/admin.html": "d4a8e2e88144e1d87f69443c5464576190774f5e03b82b84eb83e94b3f44bc6f",
 "public/apidocs.html": "ede2a9024f016fc0d749e76bb7f56ba8653f979b8751cb7dc9b2b90cdb67d205",
 "public/auth-keeper.js": "0a988594332169c79583abd23c072e0f49fbf35bc16d80a124c0ae8b07f9e89f",
 "public/back-button.js": "6ea86bfddbe3f4455f21ee19521b48f567eef9d719cad09b53417727bbdea8a2",
 "public/boost-all-services.html": "50196b6023f280fd0bc73c3aa4a91d91f1b00718a05d890000e0d8808f8146b7",
 "public/boost-history.html": "44cee617e414784328d0b0b216a7ea6228fe7636a017e8a83123d4d1255a0d0a",
 "public/boost-history.js": "0e8d80afee59c29e3f60f70d527296b87aa5f8368a0fd9ddd7b7dd3ed0c769cc",
 "public/boost-services.html": "2779ae2269ad50b903d9772449be08ed9a423d29e60def91dc7d471d3c8922c4",
 "public/boost.html": "8241f52954fdd4c24935c33dae487133833cecc5bbd526a029ce658c9d69026f",
 "public/boost.js": "016f5b5f5e5ca7b872d6da4dd8e0157aa05569f7d4ad1a2cc6f8ea950d1882e9",
 "public/boost1.html": "2a4234d452a75b2290fbf5e2d549871c7aaccfdc1e2a8f8627969c3b7ed1fd09",
 "public/boost2.html": "6455c3524be98847159ddd9c8b63ee59f34956035e7f8a16b86a572f8719f281",
 "public/buy-number.html": "1ec453d8befaf7a0cc1e0b21b6a042f6cdbdfae5985973dfa18144dbd5a27108",
 "public/buy-number.js": "0f32a0f2d97ef872cd0e2e33513e850bb0272f409764a92c15f1d46b2da86cfa",
 "public/chat.html": "1a5f40f23170940467e2cf98d290fa89bbc73a5cd023ae425fe097d1cab2937f",
 "public/css/admin-pro.css": "176e699a41a59f74934686d59ff8e9a2c0889c47cd44657197c88d2314d2cbe4",
 "public/css/announce.css": "049e05c0cce40b49d94692a890a4a36d44770553cb3ae3334433335addf85a49",
 "public/css/app-shell.css": "87fd21bdcd5b6995a7a93cc17a5661fcbebfa46dbdf1aae32c1958e59e56febb",
 "public/css/app-structure.css": "75e6d54274c4196f375cdffa8917bb45119dca3b4798cd4f9e72e97adf419f7c",
 "public/css/boost-redesign.css": "bb64f964a7adf5972f1e17baec9bb553cd581bb989bce0ee1fb7f836ebadec8b",
 "public/css/boost-wizard.css": "f53b83178b4d6003358e243ea1556e12c35780247ef956bbd6adef02221958d7",
 "public/css/boost.css": "aa0f7359a8b2b82c29e62fa1c2c9ec88e7560190a00ddc39994c41b499461a4e",
 "public/css/fix-pack.css": "e90f61013c43b46d75e9ccaed292ef1b6a93d7f3658911cf4cda8f22f9e15652",
 "public/css/layout-polish.css": "293860356f8f371bd0cea99b286b30a6510910bf6215deaf628db40dbd104727",
 "public/css/marketplace-standard.css": "22bd63c8d11a2d43411b7e1274385c701e8ac867f7890e43306dd2b6b2cd0e17",
 "public/css/marvel-nums-mobile-polish.css": "ccae026d0d241d005f8fdbd7aec1a38756d63d2614fce2714f5a5271ee6559d1",
 "public/css/marvinums-brand.css": "80c5780a356b0520d4c690e033b3b07f9a66250865593d4999fb4a0d94badc24",
 "public/css/mobile-fix.css": "fd213ee0d3485cf7d40b4b2305d12539a5993ac598b31c2836c953766c3db3c3",
 "public/css/numbers-redesign.css": "b23842f77de63135ba78a155e1bc83103b2ce94d2303a2cd57c755b4bf903f09",
 "public/css/pro-polish.css": "85bb19689fd476e328d2d67e61a4b2d5c31f39b3a99594eaf012240e21e6c105",
 "public/css/redesign.css": "17e127e35fd349a7199eff0bd5488e2583534efb468f3b01da2230af147e7c0f",
 "public/dashboard.html": "11deccc0eaa3d524401d4b20ec7f0ac49cf7f48846d8ef9c5ce73400991f2a15",
 "public/data-bill.html": "4873be5be0873e1c41e570fb263db14774052ca21450847b38d8db00b27da2e4",
 "public/deposit.html": "3a5b929adaaeddb44704b14ad99a6faaeddb8debf129b4993841c97aa63a68ff",
 "public/favicon.ico.HEIC": "edcd84a81353f3cc38f32462f0757e654af9d37ca1f791af65c8a6823d2f9624",
 "public/favicon.png": "8eee11d3e75ad074ebf3539bf3cc3a6f0931bc227d130705296d028ff0fe0d73",
 "public/game.html": "7fa5fa7afaab82d2d00da1970d788cca6bdd1c6b35a4774ad4bbb251601d9cd6",
 "public/game.js": "800b7eafc7770c1959c9623ad6f04c617740a954ad905dd61069efb127700a19",
 "public/giveaway.html": "a94e2d28d38ecc448dc96d76b6a77024e733a7d8e005f334e58fcfbffcd3e964",
 "public/groups.html": "e31e66c00c45a028ded5a370446965ff0e355237b669ef28a3eb276ed2973594",
 "public/img/marvinums-bg-phone.webp": "fcb1db31f0e7339c5743e82d12c08a8c7e473b0348e8b420c17612467549f42a",
 "public/img/marvinums-bg-social.webp": "7a4a75c06b0f773643f8a7ed8c0f2c1a680db4771e037348126d1a81534f01e8",
 "public/img/marvinums-bg-speed.webp": "b1a03760e97c306605310365d5f9957fada9b72772ad9f73faf7d8cfeb2d2f51",
 "public/img/marvinums-logo.webp": "cd4d74922c4d0aff606699420993dd41d1f0d4eacebad48b9b4bb8b45fba5b1e",
 "public/index.html": "b1deaf44dbb9ce98621be7f2b1234cf743de6c34940ec1f0cde3d5f158a755a7",
 "public/js/announcements.js": "2d8a80aceae703aaf815203754060b1ce77558fc15fe02e2c9dbdc452b904dd4",
 "public/js/app-guide.js": "1a6db049ec221772f1287a70a594ee6cbaec0de97cca8c5afd505685aa55d69f",
 "public/js/app-shell.js": "1f374009d1f8b2ebe3a82266422eab2feef59cc0ccbaad4808796e615fa1e247",
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
 "public/js/marvinums-brand.js": "a31cb747de844a4ff7f20bcab35bc4f0fca6fc4e096b90d3e430fdadd11ca1ee",
 "public/js/money.js": "d8de0084cc92ad4457863e94879d78299d161823018c8fa393f090592a3ca4fb",
 "public/js/wallet.js": "610437ba26244de49d100dfa584cadd96ec1494c9e6a4cbef4174805d8f4a701",
 "public/kls-ui.js": "61c3fa08562c41b49dff33c16aa2d3ad9b3672adf8e9a23fa3522ca4157afbdd",
 "public/live-support.js": "bc18e5b6bb6369a20679ad20c8dd95cbc3487933cb2e3146cc77fb0bbe8e3ed6",
 "public/manifest.json": "776a8d123fa0ba3b71d29da38f67c9ced7f3d4268c8b1a06cb96fba109d7c6c4",
 "public/market2.js": "0dca74ad836249a640ac04d1196186b20cd664aff25b04740158a181cd83ee1f",
 "public/market3.js": "07183527fa185b759e90f151cf07ccc37421597295bda4f7d6acd3b4b5087c9b",
 "public/marketplace.html": "445bb87fa3b4ced74260445d7b0a9fc389b27d45d6b84e5d2ef28898fcdda5fd",
 "public/marketplace.js": "376006cfc9750aa40b2aae7acdaa68842a4413f8e5eb1ed371af3323ef149642",
 "public/marketplace2.html": "310c30ac13038e8dd2adf26386dfc61b669dd985155c418584456198e5c2fe7e",
 "public/marketplace3.html": "090242a1fe7a97d6d4cefa757ea3a5f3c25696da270d392e3b596b16f2e22d44",
 "public/messages.html": "37c41b14b599a3a15f28c0913b5df7baafb6ef88782fe634c24c16fe912ccbc5",
 "public/number-history.html": "a7e999d2e8f549eda433b3cdcdc162ec25241131528c3195474a0297be625699",
 "public/order-status.html": "eae0863b7d9aeb403e9d5f9bfcc6acbfe493d9ed698d88a7168000af7e698881",
 "public/purchases.html": "6bdecc4911b484862700a95aa51345289e74ba5a0d73fb3a66c938caa8fa8f29",
 "public/referrals-fragment.html": "170821ccdff4501c1338f13877a4b357d1ebdd227e83476ddfbe790da988c684",
 "public/referrals.html": "292d2d0e13a0e78b2265b95e032343406cf52a641eea123c453895bc1e891713",
 "public/robots.txt": "236b754c33fe20a7d0f21875eca3ff66ba3de6d153c4a14dbef61fb62e35d456",
 "public/script.js": "cbd693d4763202c6df8bb443d9239b02fc569f7af357c53e4a0af67f52907a53",
 "public/settings.html": "b3bcb5c97a98f5603ceb63dd5c0d6252048344d129d3eeeba19923571d24ae1a",
 "public/style.css": "5c23c8fbb5646607741ca6ccd29163548b9a5b7b2e6a62164f25123a02ece4ce",
 "public/support.html": "5a45a3eb60aeb8b486bda4e4fc950f2ccdffcf06a583e719d6768e363d434a7f",
 "public/theme.css": "268dd239fc277da65b02e25aab47f40edfc5779900387f1bbd81e2caad8f3970",
 "public/tools.html": "ec44d49d14b400f817b380fec30ae1b981fc50d286c4ebba25c342d6757f6bae",
 "public/tools.js": "e4ca6825a1f1ebb003ff61a597b418a0b6519693dd0cb908a820d10a6a1f5495",
 "public/transactions.html": "1caef36e06968c2d22b848598a3682ee0d00be556a0741769a6c42291e72d6de",
 "public/virtual-account.html": "999dfbdde0f58bd26a3a882ecb5ed8fb32a8f795087f48e51da027b3e4ad07ba",
 "public/welcome-popup.js": "9bd5bbbdce7b4fda62ace50ffde8c7e1fa6659165abb9ccb15443302f0f2ce1b",
 "server.js": "cb7d4ee9754a04d340d666f74c6dd7d15a6d4df7e4db3c45271a4588550833fe",
 "site.config.js": "828ec119cab1cba694468edfe86c172ea0761a089e744413492abf543d1ea5c5"
};

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
  const stats = { placed: 0, alreadyOk: 0, cleaned: 0, quarantined: 0, missing: [], warnings: [] };
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
      if (!dry) { fs.mkdirSync(destDir, { recursive: true }); fs.copyFileSync(chosen.file, destAbs); }
      stats.placed++; log('placed   ' + dest);
    } else stats.alreadyOk++;

    for (const c of cands) {
      if (c.file === destAbs) continue;
      if (c.hash === chosen.hash) { if (!dry) { try { fs.unlinkSync(c.file); } catch (e) {} } stats.cleaned++; }
      else { quarantine(c.file); stats.quarantined++; log('moved to _duplicates: ' + rel(c.file)); }
    }
  }
  if (!dry) for (const d of KEEP_DIRS) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  log('\norganize: placed ' + stats.placed + ' | already in place ' + stats.alreadyOk + ' | duplicate copies removed ' + stats.cleaned + ' | different leftovers moved ' + stats.quarantined);
  if (stats.missing.length) log('NOT FOUND (upload these): ' + stats.missing.join(', '));
  stats.warnings.forEach((w) => log('WARNING: ' + w));
  return stats;
}

module.exports = { run };
if (require.main === module) {
  try { run({ dry: process.argv.indexOf('--dry') !== -1 }); } catch (e) { console.error('organize failed:', e.message); }
  process.exit(0);
}
