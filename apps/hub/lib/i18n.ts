export const HUB_LOCALES = ["ja", "en", "ko", "zh-CN", "es", "pt-BR", "fr", "de", "id", "hi", "ar", "ru", "tr", "vi", "th"] as const;
export type HubLocale = typeof HUB_LOCALES[number];
export const HUB_UI_LOCALES = HUB_LOCALES;

export const HUB_LOCALE_COOKIE = "hub_locale";

export function resolveHubLocale(value?: string | null): HubLocale {
  if (!value) return "ja";
  const normalized = value.replace("_", "-");
  const exact = HUB_LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  const language = normalized.split("-")[0]?.toLowerCase();
  return HUB_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === language) ?? "ja";
}

export function localeFromAcceptLanguage(value?: string | null): HubLocale {
  const preferred = (value ?? "").split(",").map((item) => item.trim().split(";")[0]).filter(Boolean);
  for (const candidate of preferred) {
    const resolved = resolveHubLocale(candidate);
    if (resolved !== "ja" || candidate.toLowerCase().startsWith("ja")) return resolved;
  }
  return "ja";
}

const messages = {
  ja: {
    nav: ["ホーム", "検索", "通知", "メッセージ", "トレンド", "スレッド", "Hubpedia", "コミュニティ", "リスト", "ブックマーク", "トークン", "プロフィール", "設定", "動画", "マーケット"],
    sidebar: { home: "Hub ホーム", close: "サイドバーを閉じる", open: "サイドバーを開く", navigation: "メインナビゲーション", unread: "件の未読", post: "ポストする", theme: "表示テーマを切り替える", light: "ライト", dark: "ダーク", language: "表示言語" },
    translate: {
      action: "投稿を翻訳", original: "原文を表示", loading: "翻訳中…", error: "翻訳できませんでした", settings: "設定",
      from: { ja: "日本語からの翻訳", en: "英語からの翻訳", ko: "韓国語からの翻訳", "zh-CN": "中国語からの翻訳", other: "ほかの言語からの翻訳" },
    },
  },
  en: {
    nav: ["Home", "Search", "Notifications", "Messages", "Trending", "Threads", "Hubpedia", "Community", "Lists", "Bookmarks", "Token", "Profile", "Settings", "Videos", "Market"],
    sidebar: { home: "Hub home", close: "Close sidebar", open: "Open sidebar", navigation: "Main navigation", unread: " unread", post: "Post", theme: "Change theme", light: "Light", dark: "Dark", language: "Language" },
    translate: {
      action: "Translate post", original: "Show original", loading: "Translating…", error: "Translation unavailable", settings: "Settings",
      from: { ja: "Translated from Japanese", en: "Translated from English", ko: "Translated from Korean", "zh-CN": "Translated from Chinese", other: "Translated from another language" },
    },
  },
  ko: {
    nav: ["홈", "검색", "알림", "메시지", "트렌드", "스레드", "Hubpedia", "커뮤니티", "리스트", "북마크", "토큰", "프로필", "설정", "동영상", "마켓"],
    sidebar: { home: "Hub 홈", close: "사이드바 닫기", open: "사이드바 열기", navigation: "기본 탐색", unread: "개의 읽지 않음", post: "게시하기", theme: "테마 변경", light: "라이트", dark: "다크", language: "언어" },
    translate: {
      action: "게시물 번역", original: "원문 보기", loading: "번역 중…", error: "번역을 사용할 수 없습니다", settings: "설정",
      from: { ja: "일본어에서 번역", en: "영어에서 번역", ko: "한국어에서 번역", "zh-CN": "중국어에서 번역", other: "다른 언어에서 번역" },
    },
  },
  "zh-CN": {
    nav: ["首页", "搜索", "通知", "消息", "趋势", "话题", "Hubpedia", "社区", "列表", "书签", "代币", "个人资料", "设置", "视频", "市场"],
    sidebar: { home: "Hub 首页", close: "关闭侧边栏", open: "打开侧边栏", navigation: "主导航", unread: "条未读", post: "发布", theme: "更改主题", light: "浅色", dark: "深色", language: "语言" },
    translate: {
      action: "翻译帖子", original: "显示原文", loading: "翻译中…", error: "无法翻译", settings: "设置",
      from: { ja: "译自日语", en: "译自英语", ko: "译自韩语", "zh-CN": "译自中文", other: "译自其他语言" },
    },
  },
} as const;

const extendedNavigation: Partial<Record<HubLocale, readonly string[]>> = {
  es: ["Inicio", "Buscar", "Notificaciones", "Mensajes", "Tendencias", "Temas", "Hubpedia", "Comunidades", "Listas", "Marcadores", "Tokens", "Perfil", "Ajustes", "Vídeos", "Compras"],
  "pt-BR": ["Início", "Buscar", "Notificações", "Mensagens", "Tendências", "Tópicos", "Hubpedia", "Comunidades", "Listas", "Favoritos", "Tokens", "Perfil", "Configurações", "Vídeos", "Compras"],
  fr: ["Accueil", "Rechercher", "Notifications", "Messages", "Tendances", "Sujets", "Hubpedia", "Communautés", "Listes", "Favoris", "Jetons", "Profil", "Paramètres", "Vidéos", "Achats"],
  de: ["Start", "Suchen", "Benachrichtigungen", "Nachrichten", "Trends", "Themen", "Hubpedia", "Communitys", "Listen", "Lesezeichen", "Token", "Profil", "Einstellungen", "Videos", "Shopping"],
  id: ["Beranda", "Cari", "Notifikasi", "Pesan", "Tren", "Utas", "Hubpedia", "Komunitas", "Daftar", "Markah", "Token", "Profil", "Pengaturan", "Video", "Belanja"],
  hi: ["होम", "खोज", "सूचनाएँ", "संदेश", "ट्रेंड", "थ्रेड", "Hubpedia", "समुदाय", "सूचियाँ", "बुकमार्क", "टोकन", "प्रोफ़ाइल", "सेटिंग", "वीडियो", "मार्केट"],
  ar: ["الرئيسية", "بحث", "الإشعارات", "الرسائل", "الرائج", "المواضيع", "Hubpedia", "المجتمعات", "القوائم", "الإشارات المرجعية", "الرموز", "الملف الشخصي", "الإعدادات", "الفيديوهات", "السوق"],
  ru: ["Главная", "Поиск", "Уведомления", "Сообщения", "Тренды", "Темы", "Hubpedia", "Сообщества", "Списки", "Закладки", "Токены", "Профиль", "Настройки", "Видео", "Маркет"],
  tr: ["Ana sayfa", "Ara", "Bildirimler", "Mesajlar", "Gündem", "Konular", "Hubpedia", "Topluluklar", "Listeler", "Yer imleri", "Tokenler", "Profil", "Ayarlar", "Videolar", "Alışveriş"],
  vi: ["Trang chủ", "Tìm kiếm", "Thông báo", "Tin nhắn", "Xu hướng", "Chủ đề", "Hubpedia", "Cộng đồng", "Danh sách", "Dấu trang", "Token", "Hồ sơ", "Cài đặt", "Video", "Mua sắm"],
  th: ["หน้าแรก", "ค้นหา", "การแจ้งเตือน", "ข้อความ", "มาแรง", "หัวข้อ", "Hubpedia", "ชุมชน", "รายการ", "บุ๊กมาร์ก", "โทเค็น", "โปรไฟล์", "การตั้งค่า", "วิดีโอ", "มาร์เก็ต"],
};

const extendedServices: Partial<Record<HubLocale, readonly [string, string, string, string, string, string, string]>> = {
  ja: ["音楽", "デジタル", "AI", "広告", "不動産", "乗り物", "仕事"],
  ko: ["음악", "디지털", "AI", "광고", "부동산", "차량", "일자리"],
  "zh-CN": ["音乐", "数字商品", "AI", "广告", "房地产", "车辆", "工作"],
  es: ["Música", "Digital", "AI", "Publicidad", "Inmuebles", "Vehículos", "Trabajo"],
  "pt-BR": ["Música", "Digital", "AI", "Publicidade", "Imóveis", "Veículos", "Trabalho"],
  fr: ["Musique", "Numérique", "AI", "Publicité", "Immobilier", "Véhicules", "Emploi"],
  de: ["Musik", "Digital", "AI", "Werbung", "Immobilien", "Fahrzeuge", "Arbeit"],
  id: ["Musik", "Digital", "AI", "Iklan", "Properti", "Kendaraan", "Pekerjaan"],
  hi: ["संगीत", "डिजिटल", "AI", "विज्ञापन", "रियल एस्टेट", "वाहन", "काम"],
  ar: ["موسيقى", "رقمي", "AI", "إعلانات", "عقارات", "مركبات", "عمل"],
  ru: ["Музыка", "Цифровое", "AI", "Реклама", "Недвижимость", "Транспорт", "Работа"],
  tr: ["Müzik", "Dijital", "AI", "Reklam", "Emlak", "Araçlar", "İş"],
  vi: ["Âm nhạc", "Kỹ thuật số", "AI", "Quảng cáo", "Bất động sản", "Phương tiện", "Việc làm"],
  th: ["เพลง", "ดิจิทัล", "AI", "โฆษณา", "อสังหาริมทรัพย์", "ยานพาหนะ", "งาน"],
};

export function hubMessages(locale: HubLocale) {
  const baseLocale = locale === "ja" || locale === "en" || locale === "ko" || locale === "zh-CN" ? locale : "en";
  const base = messages[baseLocale];
  const services = extendedServices[locale] ?? extendedServices.en ?? ["Music", "Digital", "AI", "Advertising", "Real estate", "Vehicles", "Work"];
  return { ...base, nav: [...(extendedNavigation[locale] ?? base.nav), ...services] };
}
