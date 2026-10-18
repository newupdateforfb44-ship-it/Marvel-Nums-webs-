/**
 * public/js/i18n.js — King Social Hub multi-language layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Two ways to translate, both handled here:
 *
 *   1. Explicit  : <span data-i18n="deposit.title">Add Funds</span>
 *   2. Automatic : any text node whose exact English text is a known phrase is
 *                  swapped in place. This lets existing pages become
 *                  multilingual without rewriting their markup.
 *
 * A MutationObserver re-translates content rendered later by script.js.
 * Arabic switches the document to RTL automatically.
 */
(function (global) {
  'use strict';

  var LANGS = [
    { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
    { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
    { code: 'pt', name: 'Portuguese', native: 'Português', flag: '🇵🇹' },
    { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦', rtl: true },
    { code: 'sw', name: 'Swahili', native: 'Kiswahili', flag: '🇰🇪' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
    { code: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳' },
    { code: 'ru', name: 'Russian', native: 'Русский', flag: '🇷🇺' },
    { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' }
  ];

  // Phrase table. Key = exact English string used in the UI.
  var PHRASES = {
    "Buy Numbers": { fr: "Acheter des numéros", es: "Comprar números", pt: "Comprar números", ar: "شراء أرقام", sw: "Nunua nambari", hi: "नंबर खरीदें", zh: "购买号码", ru: "Купить номера", de: "Nummern kaufen" },
    "Numbers": { fr: "Numéros", es: "Números", pt: "Números", ar: "الأرقام", sw: "Nambari", hi: "नंबर", zh: "号码", ru: "Номера", de: "Nummern" },
    "Logs": { fr: "Logs", es: "Registros", pt: "Registos", ar: "السجلات", sw: "Kumbukumbu", hi: "लॉग्स", zh: "账号日志", ru: "Логи", de: "Logs" },
    "Tools": { fr: "Outils", es: "Herramientas", pt: "Ferramentas", ar: "الأدوات", sw: "Zana", hi: "टूल्स", zh: "工具", ru: "Инструменты", de: "Werkzeuge" },
    "Balance": { fr: "Solde", es: "Saldo", pt: "Saldo", ar: "الرصيد", sw: "Salio", hi: "बैलेंस", zh: "余额", ru: "Баланс", de: "Guthaben" },
    "Wallet Balance": { fr: "Solde du portefeuille", es: "Saldo de la cartera", pt: "Saldo da carteira", ar: "رصيد المحفظة", sw: "Salio la pochi", hi: "वॉलेट बैलेंस", zh: "钱包余额", ru: "Баланс кошелька", de: "Guthaben" },
    "Add Funds": { fr: "Ajouter des fonds", es: "Añadir fondos", pt: "Adicionar fundos", ar: "إضافة أموال", sw: "Ongeza fedha", hi: "पैसे जोड़ें", zh: "充值", ru: "Пополнить", de: "Guthaben aufladen" },
    "Withdraw": { fr: "Retirer", es: "Retirar", pt: "Retirar", ar: "سحب", sw: "Toa pesa", hi: "निकालें", zh: "提现", ru: "Вывести", de: "Auszahlen" },
    "Price": { fr: "Prix", es: "Precio", pt: "Preço", ar: "السعر", sw: "Bei", hi: "कीमत", zh: "价格", ru: "Цена", de: "Preis" },
    "Total": { fr: "Total", es: "Total", pt: "Total", ar: "الإجمالي", sw: "Jumla", hi: "कुल", zh: "合计", ru: "Итого", de: "Gesamt" },
    "Buy Now": { fr: "Acheter maintenant", es: "Comprar ahora", pt: "Comprar agora", ar: "اشتر الآن", sw: "Nunua sasa", hi: "अभी खरीदें", zh: "立即购买", ru: "Купить сейчас", de: "Jetzt kaufen" },
    "Out of stock": { fr: "Rupture de stock", es: "Agotado", pt: "Esgotado", ar: "غير متوفر", sw: "Hakuna bidhaa", hi: "स्टॉक खत्म", zh: "缺货", ru: "Нет в наличии", de: "Nicht verfügbar" },
    "In stock": { fr: "En stock", es: "En existencia", pt: "Em stock", ar: "متوفر", sw: "Ipo", hi: "स्टॉक में", zh: "有货", ru: "В наличии", de: "Verfügbar" },
    "Available": { fr: "Disponible", es: "Disponible", pt: "Disponível", ar: "متاح", sw: "Inapatikana", hi: "उपलब्ध", zh: "可用", ru: "Доступно", de: "Verfügbar" },
    "Server 1": { fr: "Serveur 1", es: "Servidor 1", pt: "Servidor 1", ar: "السيرفر 1", sw: "Seva 1", hi: "सर्वर 1", zh: "服务器 1", ru: "Сервер 1", de: "Server 1" },
    "Server 2": { fr: "Serveur 2", es: "Servidor 2", pt: "Servidor 2", ar: "السيرفر 2", sw: "Seva 2", hi: "सर्वर 2", zh: "服务器 2", ru: "Сервер 2", de: "Server 2" },
    "Order": { fr: "Commande", es: "Pedido", pt: "Encomenda", ar: "طلب", sw: "Agizo", hi: "ऑर्डर", zh: "订单", ru: "Заказ", de: "Bestellung" },
    "Orders": { fr: "Commandes", es: "Pedidos", pt: "Encomendas", ar: "الطلبات", sw: "Maagizo", hi: "ऑर्डर", zh: "订单", ru: "Заказы", de: "Bestellungen" },
    "Status": { fr: "Statut", es: "Estado", pt: "Estado", ar: "الحالة", sw: "Hali", hi: "स्थिति", zh: "状态", ru: "Статус", de: "Status" },
    "Date": { fr: "Date", es: "Fecha", pt: "Data", ar: "التاريخ", sw: "Tarehe", hi: "तारीख़", zh: "日期", ru: "Дата", de: "Datum" },
    "Completed": { fr: "Terminé", es: "Completado", pt: "Concluído", ar: "مكتمل", sw: "Imekamilika", hi: "पूर्ण", zh: "已完成", ru: "Завершено", de: "Abgeschlossen" },
    "Failed": { fr: "Échoué", es: "Fallido", pt: "Falhou", ar: "فشل", sw: "Imeshindikana", hi: "असफल", zh: "失败", ru: "Ошибка", de: "Fehlgeschlagen" },
    "Expired": { fr: "Expiré", es: "Caducado", pt: "Expirado", ar: "منتهي", sw: "Imeisha", hi: "समाप्त", zh: "已过期", ru: "Истёк", de: "Abgelaufen" },
    "Processing": { fr: "En cours", es: "Procesando", pt: "Em processamento", ar: "جارٍ المعالجة", sw: "Inachakatwa", hi: "प्रोसेस हो रहा है", zh: "处理中", ru: "Обработка", de: "Wird verarbeitet" },
    "Loading…": { fr: "Chargement…", es: "Cargando…", pt: "A carregar…", ar: "جارٍ التحميل…", sw: "Inapakia…", hi: "लोड हो रहा है…", zh: "加载中…", ru: "Загрузка…", de: "Wird geladen…" },
    "Try again": { fr: "Réessayer", es: "Intentar de nuevo", pt: "Tentar novamente", ar: "حاول مرة أخرى", sw: "Jaribu tena", hi: "फिर कोशिश करें", zh: "重试", ru: "Повторить", de: "Erneut versuchen" },
    "Save": { fr: "Enregistrer", es: "Guardar", pt: "Guardar", ar: "حفظ", sw: "Hifadhi", hi: "सहेजें", zh: "保存", ru: "Сохранить", de: "Speichern" },
    "Save number": { fr: "Enregistrer le numéro", es: "Guardar número", pt: "Guardar número", ar: "حفظ الرقم", sw: "Hifadhi nambari", hi: "नंबर सहेजें", zh: "保存号码", ru: "Сохранить номер", de: "Nummer speichern" },
    "Close": { fr: "Fermer", es: "Cerrar", pt: "Fechar", ar: "إغلاق", sw: "Funga", hi: "बंद करें", zh: "关闭", ru: "Закрыть", de: "Schließen" },
    "Back": { fr: "Retour", es: "Atrás", pt: "Voltar", ar: "رجوع", sw: "Nyuma", hi: "वापस", zh: "返回", ru: "Назад", de: "Zurück" },
    "Done": { fr: "Terminé", es: "Hecho", pt: "Concluído", ar: "تم", sw: "Imekwisha", hi: "पूर्ण", zh: "完成", ru: "Готово", de: "Fertig" },
    "Search": { fr: "Rechercher", es: "Buscar", pt: "Procurar", ar: "بحث", sw: "Tafuta", hi: "खोजें", zh: "搜索", ru: "Поиск", de: "Suchen" },
    "Profile": { fr: "Profil", es: "Perfil", pt: "Perfil", ar: "الملف الشخصي", sw: "Wasifu", hi: "प्रोफ़ाइल", zh: "个人资料", ru: "Профиль", de: "Profil" },
    "Change Password": { fr: "Changer le mot de passe", es: "Cambiar contraseña", pt: "Alterar palavra-passe", ar: "تغيير كلمة المرور", sw: "Badilisha nenosiri", hi: "पासवर्ड बदलें", zh: "修改密码", ru: "Сменить пароль", de: "Passwort ändern" },
    "Update Password": { fr: "Mettre à jour le mot de passe", es: "Actualizar contraseña", pt: "Atualizar palavra-passe", ar: "تحديث كلمة المرور", sw: "Sasisha nenosiri", hi: "पासवर्ड अपडेट करें", zh: "更新密码", ru: "Обновить пароль", de: "Passwort aktualisieren" },
    "Current Password": { fr: "Mot de passe actuel", es: "Contraseña actual", pt: "Palavra-passe atual", ar: "كلمة المرور الحالية", sw: "Nenosiri la sasa", hi: "वर्तमान पासवर्ड", zh: "当前密码", ru: "Текущий пароль", de: "Aktuelles Passwort" },
    "New Password": { fr: "Nouveau mot de passe", es: "Nueva contraseña", pt: "Nova palavra-passe", ar: "كلمة المرور الجديدة", sw: "Nenosiri jipya", hi: "नया पासवर्ड", zh: "新密码", ru: "Новый пароль", de: "Neues Passwort" },
    "Referrals": { fr: "Parrainages", es: "Referidos", pt: "Referências", ar: "الإحالات", sw: "Rufaa", hi: "रेफ़रल", zh: "推荐", ru: "Приглашения", de: "Empfehlungen" },
    "Notifications": { fr: "Notifications", es: "Notificaciones", pt: "Notificações", ar: "الإشعارات", sw: "Arifa", hi: "सूचनाएँ", zh: "通知", ru: "Уведомления", de: "Benachrichtigungen" },
    "Country & Contact Number": { fr: "Pays et numéro de contact", es: "País y número de contacto", pt: "País e número de contacto", ar: "الدولة ورقم الاتصال", sw: "Nchi na nambari ya simu", hi: "देश और संपर्क नंबर", zh: "国家与联系号码", ru: "Страна и номер телефона", de: "Land & Kontaktnummer" },
    "Bank Transfer": { fr: "Virement bancaire", es: "Transferencia bancaria", pt: "Transferência bancária", ar: "تحويل بنكي", sw: "Uhamisho wa benki", hi: "बैंक ट्रांसफ़र", zh: "银行转账", ru: "Банковский перевод", de: "Banküberweisung" },
    "Card Payment": { fr: "Paiement par carte", es: "Pago con tarjeta", pt: "Pagamento com cartão", ar: "الدفع بالبطاقة", sw: "Malipo ya kadi", hi: "कार्ड भुगतान", zh: "银行卡支付", ru: "Оплата картой", de: "Kartenzahlung" },
    "Payment Method": { fr: "Moyen de paiement", es: "Método de pago", pt: "Método de pagamento", ar: "طريقة الدفع", sw: "Njia ya malipo", hi: "भुगतान का तरीक़ा", zh: "支付方式", ru: "Способ оплаты", de: "Zahlungsmethode" },
    "Choose a payment method": { fr: "Choisissez un moyen de paiement", es: "Elige un método de pago", pt: "Escolha um método de pagamento", ar: "اختر طريقة الدفع", sw: "Chagua njia ya malipo", hi: "भुगतान का तरीक़ा चुनें", zh: "选择支付方式", ru: "Выберите способ оплаты", de: "Zahlungsmethode wählen" },
    "Deposit address": { fr: "Adresse de dépôt", es: "Dirección de depósito", pt: "Endereço de depósito", ar: "عنوان الإيداع", sw: "Anwani ya kuweka fedha", hi: "जमा पता", zh: "充值地址", ru: "Адрес для пополнения", de: "Einzahlungsadresse" },
    "Network": { fr: "Réseau", es: "Red", pt: "Rede", ar: "الشبكة", sw: "Mtandao", hi: "नेटवर्क", zh: "网络", ru: "Сеть", de: "Netzwerk" },
    "Get deposit address": { fr: "Obtenir l’adresse de dépôt", es: "Obtener dirección de depósito", pt: "Obter endereço de depósito", ar: "احصل على عنوان الإيداع", sw: "Pata anwani ya kuweka fedha", hi: "जमा पता प्राप्त करें", zh: "获取充值地址", ru: "Получить адрес", de: "Einzahlungsadresse anzeigen" },
    "How much do you want to add?": { fr: "Combien voulez-vous ajouter ?", es: "¿Cuánto quieres añadir?", pt: "Quanto quer adicionar?", ar: "كم تريد أن تضيف؟", sw: "Unataka kuongeza kiasi gani?", hi: "आप कितना जोड़ना चाहते हैं?", zh: "您想充值多少？", ru: "Сколько хотите пополнить?", de: "Wie viel möchten Sie aufladen?" },
    "Enter an amount to see the exact crypto total.": { fr: "Saisissez un montant pour voir le total exact en crypto.", es: "Introduce un importe para ver el total exacto en cripto.", pt: "Introduza um montante para ver o total exato em cripto.", ar: "أدخل المبلغ لعرض الإجمالي الدقيق بالعملة الرقمية.", sw: "Weka kiasi ili kuona jumla kamili ya crypto.", hi: "सटीक क्रिप्टो राशि देखने के लिए रकम डालें।", zh: "输入金额以查看准确的加密货币总额。", ru: "Введите сумму, чтобы увидеть точный итог в крипто.", de: "Betrag eingeben, um den genauen Krypto-Betrag zu sehen." },
    "Send only the selected coin on the selected network. Anything else may be lost.": { fr: "Envoyez uniquement la pièce choisie sur le réseau choisi. Tout autre envoi peut être perdu.", es: "Envía solo la moneda elegida en la red elegida. Cualquier otra cosa puede perderse.", pt: "Envie apenas a moeda escolhida na rede escolhida. Qualquer outra coisa pode ser perdida.", ar: "أرسل العملة المحددة على الشبكة المحددة فقط، وإلا فقد تُفقد أموالك.", sw: "Tuma sarafu iliyochaguliwa kwenye mtandao uliochaguliwa pekee. Vinginevyo fedha zinaweza kupotea.", hi: "केवल चुनी गई कॉइन को चुने गए नेटवर्क पर भेजें, वरना राशि खो सकती है।", zh: "仅通过所选网络发送所选币种，否则资金可能丢失。", ru: "Отправляйте только выбранную монету в выбранной сети, иначе средства могут быть утеряны.", de: "Senden Sie nur die gewählte Coin im gewählten Netzwerk, sonst kann das Geld verloren gehen." },
    "Confirmation is automatic": { fr: "La confirmation est automatique", es: "La confirmación es automática", pt: "A confirmação é automática", ar: "التأكيد تلقائي", sw: "Uthibitisho ni wa kiotomatiki", hi: "पुष्टि स्वतः होती है", zh: "确认为自动进行", ru: "Подтверждение автоматическое", de: "Die Bestätigung erfolgt automatisch" },
    "Wallet unavailable": { fr: "Portefeuille indisponible", es: "Cartera no disponible", pt: "Carteira indisponível", ar: "المحفظة غير متاحة", sw: "Pochi haipatikani", hi: "वॉलेट अनुपलब्ध", zh: "钱包不可用", ru: "Кошелёк недоступен", de: "Guthaben nicht verfügbar" },
    "No transactions yet": { fr: "Aucune transaction pour l’instant", es: "Aún no hay transacciones", pt: "Ainda não há transações", ar: "لا توجد معاملات بعد", sw: "Hakuna miamala bado", hi: "अभी कोई लेन-देन नहीं", zh: "暂无交易", ru: "Пока нет транзакций", de: "Noch keine Transaktionen" },
    "Contact Support": { fr: "Contacter l’assistance", es: "Contactar con soporte", pt: "Contactar o suporte", ar: "اتصل بالدعم", sw: "Wasiliana na msaada", hi: "सहायता से संपर्क करें", zh: "联系客服", ru: "Связаться с поддержкой", de: "Support kontaktieren" },
    "Live Chat": { fr: "Chat en direct", es: "Chat en vivo", pt: "Chat ao vivo", ar: "محادثة مباشرة", sw: "Gumzo la moja kwa moja", hi: "लाइव चैट", zh: "在线客服", ru: "Онлайн-чат", de: "Live-Chat" },
    "Send Message": { fr: "Envoyer le message", es: "Enviar mensaje", pt: "Enviar mensagem", ar: "إرسال الرسالة", sw: "Tuma ujumbe", hi: "संदेश भेजें", zh: "发送消息", ru: "Отправить", de: "Nachricht senden" },
    "You will be charged in US dollars ($) for numbers, logs and tools.": { fr: "Vous serez facturé en dollars américains ($) pour les numéros, logs et outils.", es: "Se te cobrará en dólares estadounidenses ($) por números, registros y herramientas.", pt: "Será cobrado em dólares americanos ($) por números, registos e ferramentas.", ar: "ستُحاسب بالدولار الأمريكي ($) على الأرقام والسجلات والأدوات.", sw: "Utalipishwa kwa dola za Marekani ($) kwa nambari, kumbukumbu na zana.", hi: "नंबर, लॉग्स और टूल्स के लिए आपसे अमेरिकी डॉलर ($) में शुल्क लिया जाएगा।", zh: "号码、账号日志和工具将以美元（$）计费。", ru: "Оплата номеров, логов и инструментов будет в долларах США ($).", de: "Nummern, Logs und Tools werden in US-Dollar ($) abgerechnet." },
    "Pick your country and enter your mobile number.": { fr: "Choisissez votre pays et saisissez votre numéro de mobile.", es: "Elige tu país e introduce tu número de móvil.", pt: "Escolha o seu país e introduza o número de telemóvel.", ar: "اختر دولتك وأدخل رقم هاتفك المحمول.", sw: "Chagua nchi yako na uweke nambari ya simu.", hi: "अपना देश चुनें और मोबाइल नंबर डालें।", zh: "请选择国家并输入手机号码。", ru: "Выберите страну и введите номер мобильного.", de: "Land wählen und Mobilnummer eingeben." },
    "How this works:": { fr: "Comment cela fonctionne :", es: "Cómo funciona:", pt: "Como funciona:", ar: "كيف يعمل ذلك:", sw: "Jinsi inavyofanya kazi:", hi: "यह कैसे काम करता है:", zh: "运作方式：", ru: "Как это работает:", de: "So funktioniert es:" },
    'Update your phone number': { fr: 'Mettez à jour votre numéro de téléphone', es: 'Actualiza tu número de teléfono', pt: 'Atualize o seu número de telefone', ar: 'حدّث رقم هاتفك', sw: 'Sasisha nambari yako ya simu', hi: 'अपना फ़ोन नंबर अपडेट करें', zh: '更新您的电话号码', ru: 'Обновите номер телефона', de: 'Aktualisieren Sie Ihre Telefonnummer' },
    'Save and continue': { fr: 'Enregistrer et continuer', es: 'Guardar y continuar', pt: 'Guardar e continuar', ar: 'حفظ ومتابعة', sw: 'Hifadhi na uendelee', hi: 'सहेजें और जारी रखें', zh: '保存并继续', ru: 'Сохранить и продолжить', de: 'Speichern und fortfahren' },
    'Confirmed deposits': { fr: 'Dépôts confirmés', es: 'Depósitos confirmados', pt: 'Depósitos confirmados', ar: 'الإيداعات المؤكدة', sw: 'Amana zilizothibitishwa', hi: 'पुष्ट जमा', zh: '已确认充值', ru: 'Подтверждённые пополнения', de: 'Bestätigte Einzahlungen' },
    'Pending confirmation': { fr: 'En attente de confirmation', es: 'Pendiente de confirmación', pt: 'A aguardar confirmação', ar: 'في انتظار التأكيد', sw: 'Inasubiri uthibitisho', hi: 'पुष्टि लंबित', zh: '等待确认', ru: 'Ожидает подтверждения', de: 'Bestätigung ausstehend' },
    'Confirmed': { fr: 'Confirmé', es: 'Confirmado', pt: 'Confirmado', ar: 'مؤكد', sw: 'Imethibitishwa', hi: 'पुष्ट', zh: '已确认', ru: 'Подтверждено', de: 'Bestätigt' },
    'Pending': { fr: 'En attente', es: 'Pendiente', pt: 'Pendente', ar: 'قيد الانتظار', sw: 'Inasubiri', hi: 'लंबित', zh: '待处理', ru: 'В ожидании', de: 'Ausstehend' },
    'Refresh': { fr: 'Actualiser', es: 'Actualizar', pt: 'Atualizar', ar: 'تحديث', sw: 'Onyesha upya', hi: 'रिफ़्रेश', zh: '刷新', ru: 'Обновить', de: 'Aktualisieren' },
    'Home': { fr: 'Accueil', es: 'Inicio', pt: 'Início', ar: 'الرئيسية', sw: 'Nyumbani', hi: 'होम', zh: '首页', ru: 'Главная', de: 'Startseite' },
    'Marketplace': { fr: 'Marché', es: 'Mercado', pt: 'Mercado', ar: 'السوق', sw: 'Soko', hi: 'बाज़ार', zh: '市场', ru: 'Маркет', de: 'Marktplatz' },
    'Wallet': { fr: 'Portefeuille', es: 'Cartera', pt: 'Carteira', ar: 'المحفظة', sw: 'Pochi', hi: 'वॉलेट', zh: '钱包', ru: 'Кошелёк', de: 'Geldbörse' },
    'Deposit': { fr: 'Dépôt', es: 'Depósito', pt: 'Depósito', ar: 'إيداع', sw: 'Weka pesa', hi: 'जमा', zh: '充值', ru: 'Пополнить', de: 'Einzahlung' },
    'Deposits': { fr: 'Dépôts', es: 'Depósitos', pt: 'Depósitos', ar: 'الإيداعات', sw: 'Amana', hi: 'जमा', zh: '充值记录', ru: 'Пополнения', de: 'Einzahlungen' },
    'Transactions': { fr: 'Transactions', es: 'Transacciones', pt: 'Transações', ar: 'المعاملات', sw: 'Miamala', hi: 'लेन-देन', zh: '交易', ru: 'Транзакции', de: 'Transaktionen' },
    'Purchases': { fr: 'Achats', es: 'Compras', pt: 'Compras', ar: 'المشتريات', sw: 'Manunuzi', hi: 'खरीदारी', zh: '购买记录', ru: 'Покупки', de: 'Käufe' },
    'Settings': { fr: 'Paramètres', es: 'Ajustes', pt: 'Definições', ar: 'الإعدادات', sw: 'Mipangilio', hi: 'सेटिंग्स', zh: '设置', ru: 'Настройки', de: 'Einstellungen' },
    'Support': { fr: 'Assistance', es: 'Soporte', pt: 'Suporte', ar: 'الدعم', sw: 'Msaada', hi: 'सहायता', zh: '客服', ru: 'Поддержка', de: 'Support' },
    'Login': { fr: 'Connexion', es: 'Iniciar sesión', pt: 'Entrar', ar: 'تسجيل الدخول', sw: 'Ingia', hi: 'लॉगिन', zh: '登录', ru: 'Вход', de: 'Anmelden' },
    'Register': { fr: 'S’inscrire', es: 'Registrarse', pt: 'Registar', ar: 'إنشاء حساب', sw: 'Jisajili', hi: 'रजिस्टर', zh: '注册', ru: 'Регистрация', de: 'Registrieren' },
    'Logout': { fr: 'Déconnexion', es: 'Cerrar sesión', pt: 'Sair', ar: 'تسجيل الخروج', sw: 'Toka', hi: 'लॉगआउट', zh: '退出', ru: 'Выйти', de: 'Abmelden' },
    'Create Account': { fr: 'Créer un compte', es: 'Crear cuenta', pt: 'Criar conta', ar: 'إنشاء حساب', sw: 'Fungua akaunti', hi: 'खाता बनाएँ', zh: '创建账户', ru: 'Создать аккаунт', de: 'Konto erstellen' },
    'Full Name': { fr: 'Nom complet', es: 'Nombre completo', pt: 'Nome completo', ar: 'الاسم الكامل', sw: 'Jina kamili', hi: 'पूरा नाम', zh: '姓名', ru: 'Полное имя', de: 'Vollständiger Name' },
    'Email Address': { fr: 'Adresse e-mail', es: 'Correo electrónico', pt: 'Endereço de e-mail', ar: 'البريد الإلكتروني', sw: 'Barua pepe', hi: 'ईमेल पता', zh: '电子邮箱', ru: 'Электронная почта', de: 'E-Mail-Adresse' },
    'Password': { fr: 'Mot de passe', es: 'Contraseña', pt: 'Palavra-passe', ar: 'كلمة المرور', sw: 'Nenosiri', hi: 'पासवर्ड', zh: '密码', ru: 'Пароль', de: 'Passwort' },
    'Confirm Password': { fr: 'Confirmer le mot de passe', es: 'Confirmar contraseña', pt: 'Confirmar palavra-passe', ar: 'تأكيد كلمة المرور', sw: 'Thibitisha nenosiri', hi: 'पासवर्ड की पुष्टि करें', zh: '确认密码', ru: 'Подтвердите пароль', de: 'Passwort bestätigen' },
    'Phone Number': { fr: 'Numéro de téléphone', es: 'Número de teléfono', pt: 'Número de telefone', ar: 'رقم الهاتف', sw: 'Nambari ya simu', hi: 'फ़ोन नंबर', zh: '电话号码', ru: 'Номер телефона', de: 'Telefonnummer' },
    'Country': { fr: 'Pays', es: 'País', pt: 'País', ar: 'الدولة', sw: 'Nchi', hi: 'देश', zh: '国家', ru: 'Страна', de: 'Land' },
    'Search country': { fr: 'Rechercher un pays', es: 'Buscar país', pt: 'Procurar país', ar: 'ابحث عن دولة', sw: 'Tafuta nchi', hi: 'देश खोजें', zh: '搜索国家', ru: 'Поиск страны', de: 'Land suchen' },
    'Language': { fr: 'Langue', es: 'Idioma', pt: 'Idioma', ar: 'اللغة', sw: 'Lugha', hi: 'भाषा', zh: '语言', ru: 'Язык', de: 'Sprache' },
    'Currency': { fr: 'Devise', es: 'Moneda', pt: 'Moeda', ar: 'العملة', sw: 'Sarafu', hi: 'मुद्रा', zh: '货币', ru: 'Валюта', de: 'Währung' },
    'Amount': { fr: 'Montant', es: 'Importe', pt: 'Montante', ar: 'المبلغ', sw: 'Kiasi', hi: 'राशि', zh: '金额', ru: 'Сумма', de: 'Betrag' },
    'Continue': { fr: 'Continuer', es: 'Continuar', pt: 'Continuar', ar: 'متابعة', sw: 'Endelea', hi: 'जारी रखें', zh: '继续', ru: 'Продолжить', de: 'Weiter' },
    'Cancel': { fr: 'Annuler', es: 'Cancelar', pt: 'Cancelar', ar: 'إلغاء', sw: 'Ghairi', hi: 'रद्द करें', zh: '取消', ru: 'Отмена', de: 'Abbrechen' },
    'Copy': { fr: 'Copier', es: 'Copiar', pt: 'Copiar', ar: 'نسخ', sw: 'Nakili', hi: 'कॉपी', zh: '复制', ru: 'Копировать', de: 'Kopieren' },
    'Copied!': { fr: 'Copié !', es: '¡Copiado!', pt: 'Copiado!', ar: 'تم النسخ!', sw: 'Imenakiliwa!', hi: 'कॉपी हो गया!', zh: '已复制！', ru: 'Скопировано!', de: 'Kopiert!' },
    'Card': { fr: 'Carte', es: 'Tarjeta', pt: 'Cartão', ar: 'بطاقة', sw: 'Kadi', hi: 'कार्ड', zh: '银行卡', ru: 'Карта', de: 'Karte' },
    'Bank Transfer': { fr: 'Virement bancaire', es: 'Transferencia bancaria', pt: 'Transferência bancária', ar: 'تحويل بنكي', sw: 'Uhamisho wa benki', hi: 'बैंक ट्रांसफ़र', zh: '银行转账', ru: 'Банковский перевод', de: 'Banküberweisung' },
    'Mobile Money': { fr: 'Mobile Money', es: 'Dinero móvil', pt: 'Dinheiro móvel', ar: 'الأموال عبر الهاتف', sw: 'Pesa ya simu', hi: 'मोबाइल मनी', zh: '移动支付', ru: 'Мобильные деньги', de: 'Mobile Money' },
    'Waiting for payment…': { fr: 'En attente du paiement…', es: 'Esperando el pago…', pt: 'A aguardar pagamento…', ar: 'في انتظار الدفع…', sw: 'Inasubiri malipo…', hi: 'भुगतान की प्रतीक्षा…', zh: '等待付款…', ru: 'Ожидание платежа…', de: 'Warte auf Zahlung…' },
    'Payment Received!': { fr: 'Paiement reçu !', es: '¡Pago recibido!', pt: 'Pagamento recebido!', ar: 'تم استلام الدفع!', sw: 'Malipo yamepokelewa!', hi: 'भुगतान प्राप्त हुआ!', zh: '已收到付款！', ru: 'Платёж получен!', de: 'Zahlung erhalten!' },
    'Your wallet has been credited automatically.': { fr: 'Votre portefeuille a été crédité automatiquement.', es: 'Tu cartera se ha acreditado automáticamente.', pt: 'A sua carteira foi creditada automaticamente.', ar: 'تم شحن محفظتك تلقائيًا.', sw: 'Pochi yako imewekewa pesa kiotomatiki.', hi: 'आपके वॉलेट में स्वतः राशि जोड़ दी गई है।', zh: '您的钱包已自动到账。', ru: 'Ваш кошелёк пополнен автоматически.', de: 'Ihre Geldbörse wurde automatisch gutgeschrieben.' },
    'Available Balance': { fr: 'Solde disponible', es: 'Saldo disponible', pt: 'Saldo disponível', ar: 'الرصيد المتاح', sw: 'Salio lililopo', hi: 'उपलब्ध शेष', zh: '可用余额', ru: 'Доступный баланс', de: 'Verfügbares Guthaben' },
    'Add Funds to Your Wallet': { fr: 'Alimentez votre portefeuille', es: 'Añade fondos a tu cartera', pt: 'Adicione fundos à sua carteira', ar: 'أضف أموالاً إلى محفظتك', sw: 'Ongeza pesa kwenye pochi yako', hi: 'अपने वॉलेट में पैसे जोड़ें', zh: '为钱包充值', ru: 'Пополните кошелёк', de: 'Guthaben aufladen' }
  };

  var STORAGE_KEY = 'kls_lang';
  var current = 'en';
  var observer = null;

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGS.some(function (l) { return l.code === saved; })) return saved;
    } catch (e) { /* private mode */ }
    var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS.some(function (l) { return l.code === nav; }) ? nav : 'en';
  }

  // ── MACHINE-TRANSLATION LAYER ─────────────────────────────────────────────
  // The phrase table above answers instantly. Everything else is sent to
  // /api/i18n/translate in batches, cached in localStorage, and re-applied.
  // That is what makes the WHOLE site switch language, not just the strings
  // somebody remembered to add to the table.
  var remote = {};              // text -> translated, for `current`
  var pending = {};             // text -> true, queued for the next batch
  var asked = {};               // text -> true, already requested (never re-ask)
  var flushTimer = null;
  var origText = new WeakMap(); // text node -> original English

  function cacheKey() { return 'kls_i18n_' + current; }

  function loadCache() {
    remote = {};
    if (current === 'en') return;
    try {
      var raw = localStorage.getItem(cacheKey());
      if (raw) remote = JSON.parse(raw) || {};
    } catch (e) { remote = {}; }
  }

  function saveCache() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(remote)); } catch (e) { /* quota */ }
  }

  // Only send things that look like real UI copy: skip numbers, money, codes,
  // wallet addresses and anything already translated.
  function translatable(text) {
    if (!text || text.length > 400) return false;
    if (!/[A-Za-z]/.test(text)) return false;
    if (/^[\W\d\s]+$/.test(text)) return false;
    if (/^[₦$€£]?[\d,.\s]+$/.test(text)) return false;
    if (/^(0x)?[A-Fa-f0-9]{16,}$/.test(text)) return false;
    if (/^[A-Z0-9\-_]{10,}$/.test(text)) return false;   // references / IDs
    if (/^https?:\/\//.test(text)) return false;
    if (/\S+@\S+\.\S+/.test(text)) return false;
    return true;
  }

  function queue(text) {
    if (current === 'en') return;
    if (asked[text] || remote[text] || PHRASES[text]) return;
    if (!translatable(text)) return;
    pending[text] = true;
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 300);
  }

  function flush() {
    flushTimer = null;
    var texts = Object.keys(pending).slice(0, 80);
    if (!texts.length) return;
    texts.forEach(function (t0) { delete pending[t0]; asked[t0] = true; });
    fetch('/api/i18n/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: current, texts: texts })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.translations) return;
        var changed = false;
        Object.keys(d.translations).forEach(function (k) {
          if (d.translations[k] && d.translations[k] !== k) { remote[k] = d.translations[k]; changed = true; }
        });
        if (changed) { saveCache(); translateTree(document.body); }
        if (Object.keys(pending).length && !flushTimer) flushTimer = setTimeout(flush, 300);
      })
      .catch(function () { /* stay in English for those strings */ });
  }

  /** Translate one string. Unknown strings are queued for the server. */
  function t(text) {
    if (current === 'en') return text;
    var entry = PHRASES[text];
    if (entry && entry[current]) return entry[current];
    if (remote[text]) return remote[text];
    queue(text);
    return text;
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1, OPTION: 0 };
  var ATTRS = ['title', 'aria-label', 'alt', 'data-tooltip'];

  function translateTree(root) {
    if (current === 'en' || !root) return;
    // 1. Explicit data-i18n (original English kept in data-i18n-src)
    var tagged = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
    for (var i = 0; i < tagged.length; i++) {
      var el = tagged[i];
      if (!el.hasAttribute('data-i18n-src')) el.setAttribute('data-i18n-src', el.textContent.trim());
      el.textContent = t(el.getAttribute('data-i18n-src'));
    }
    // 2. Placeholders
    var inputs = root.querySelectorAll ? root.querySelectorAll('[placeholder]') : [];
    for (var k = 0; k < inputs.length; k++) {
      var inp = inputs[k];
      if (!inp.hasAttribute('data-ph-src')) inp.setAttribute('data-ph-src', inp.getAttribute('placeholder'));
      inp.setAttribute('placeholder', t(inp.getAttribute('data-ph-src')));
    }
    // 3. Attributes people actually read: tooltips, labels, image alts
    for (var a = 0; a < ATTRS.length; a++) {
      var attr = ATTRS[a];
      var withAttr = root.querySelectorAll ? root.querySelectorAll('[' + attr + ']') : [];
      for (var b = 0; b < withAttr.length; b++) {
        var node2 = withAttr[b];
        var srcAttr = 'data-src-' + attr.replace(/[^a-z]/g, '');
        if (!node2.hasAttribute(srcAttr)) node2.setAttribute(srcAttr, node2.getAttribute(attr) || '');
        var src2 = node2.getAttribute(srcAttr);
        if (src2) node2.setAttribute(attr, t(src2));
      }
    }
    // 4. <option> labels (country pickers, dropdowns)
    var opts = root.querySelectorAll ? root.querySelectorAll('option') : [];
    for (var o = 0; o < opts.length; o++) {
      var op = opts[o];
      if (!op.hasAttribute('data-i18n-src')) op.setAttribute('data-i18n-src', op.textContent.trim());
      var opSrc = op.getAttribute('data-i18n-src');
      if (opSrc) op.textContent = t(opSrc);
    }
    // 5. Every remaining free-standing text node
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && SKIP_TAGS[node.parentNode.nodeName]) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest('[data-i18n],[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      // Remember the English once, so switching languages never translates a
      // translation (which is how text used to drift into nonsense).
      var raw = origText.get(node);
      if (raw === undefined) { raw = node.nodeValue.trim(); origText.set(node, raw); }
      var translated = t(raw);
      if (translated !== node.nodeValue.trim()) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), translated);
    }
  }

  function apply(lang, opts) {
    current = LANGS.some(function (l) { return l.code === lang; }) ? lang : 'en';
    try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* ignore */ }
    var meta = LANGS.filter(function (l) { return l.code === current; })[0];
    loadCache();
    asked = {}; pending = {};
    document.documentElement.lang = current;
    document.documentElement.dir = meta && meta.rtl ? 'rtl' : 'ltr';
    if (current === 'en' && !(opts && opts.initial)) { location.reload(); return; }
    translateTree(document.body);
    startObserver();
    document.dispatchEvent(new CustomEvent('kls:languagechange', { detail: { lang: current } }));
    // Persist to the account when signed in
    try {
      var token = localStorage.getItem('ksl_token');
      if (token) {
        fetch('/api/me/locale', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ language: current })
        }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function startObserver() {
    if (observer || current === 'en') return;
    observer = new MutationObserver(function (mutations) {
      observer.disconnect();
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) translateTree(added[j]);
          else if (added[j].nodeType === 3) {
            var raw = (added[j].nodeValue || '').trim();
            if (raw && t(raw) !== raw) added[j].nodeValue = added[j].nodeValue.replace(raw, t(raw));
          }
        }
      }
      observer.observe(document.body, { childList: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Renders the globe language button into any container (or the navbar). */
  function mountSwitcher(container) {
    var host = container || document.querySelector('.nav-right');
    if (!host || host.querySelector('.kls-lang')) return;
    var wrap = document.createElement('div');
    wrap.className = 'kls-lang';
    var meta = LANGS.filter(function (l) { return l.code === current; })[0] || LANGS[0];
    wrap.innerHTML =
      '<button class="kls-lang-btn" type="button" aria-haspopup="listbox" aria-label="Change language">' +
        '<span class="kls-lang-flag">' + meta.flag + '</span><span class="kls-lang-code">' + meta.code.toUpperCase() + '</span>' +
      '</button>' +
      '<div class="kls-lang-menu" role="listbox">' +
        LANGS.map(function (l) {
          return '<button class="kls-lang-opt' + (l.code === current ? ' active' : '') + '" role="option" data-lang="' + l.code + '">' +
            '<span>' + l.flag + '</span><span>' + l.native + '</span></button>';
        }).join('') +
      '</div>';
    host.insertBefore(wrap, host.firstChild);
    var btn = wrap.querySelector('.kls-lang-btn');
    btn.addEventListener('click', function (e) { e.stopPropagation(); wrap.classList.toggle('open'); });
    wrap.querySelectorAll('.kls-lang-opt').forEach(function (opt) {
      opt.addEventListener('click', function () { wrap.classList.remove('open'); apply(opt.getAttribute('data-lang')); });
    });
    document.addEventListener('click', function () { wrap.classList.remove('open'); });
  }

  var KLSi18n = {
    languages: LANGS,
    get current() { return current; },
    t: t,
    setLanguage: apply,
    translate: translateTree,
    mountSwitcher: mountSwitcher
  };
  global.KLSi18n = KLSi18n;

  function init() {
    apply(detect(), { initial: true });
    mountSwitcher();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
