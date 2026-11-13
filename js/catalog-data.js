(function (global) {
  "use strict";

  const ns = global.__MusicBox || (global.__MusicBox = {});

  const KEYS = {
    STORE: "gh-music-box-settings-v2",
    CACHE: "gh-music-box-cache-v2",
    VIEW: "gh-view-v2",
    LYRICS_OPEN: "gh-lyrics-open",
    LYRICS_TRANS: "gh-lyrics-trans",
    LIVE_LYRICS: "gh-lyrics-live-v1",
    VINYL_FX: "gh-vinyl-fx",
    SYNTH_FX: "gh-synth-fx",
    SHUFFLE: "gh-shuffle",
    REPEAT: "gh-repeat",
    VOLUME: "gh-volume",
    FAVORITES: "gh-favorites-v1",
    RECENT: "gh-recent-v1",
    RESUME: "gh-resume-v1",
    EQ: "gh-eq-v1",
    FX_MIX: "gh-fx-mix-v1",
    SPEED: "gh-speed-v1",
    CROSSFADE: "gh-crossfade-v1",
    SPECTRUM: "gh-spectrum-v1",
  };

  const COLLECTION_FAVORITES = "__favorites__";
  const COLLECTION_RECENT = "__recent__";

  const AUDIO_EXTS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "webm"];
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
  const COVER_NAMES = ["cover", "folder", "album", "albumart", "artwork", "front", "poster"];

  // 连续多少首播放失败后停止自动跳歌(防止断网时无限跳歌)
  const MAX_ERROR_STREAK = 3;

  // 十五大维多利亚风格唱片集与国歌军乐特辑定义(顺序即展示顺序)
  const GENRE_PRESETS = [
    {
      id: "黄金年代 · 爵士名伶",
      category: "salon",
      sub: "Billie Holiday · Ella · Chet Baker · Julie London",
      seal: "#c98236",
      desc: "1930–60 年代烟嗓名伶与摇摆黄金岁月，留声机最经典的温柔夜色。",
    },
    {
      id: "交响爵士 · 浪漫夜曲",
      category: "salon",
      sub: "Laufey & 冰岛交响乐团 · Anthony Lazaro",
      seal: "#b85668",
      desc: "古典管弦乐团与现代爵士女声的浪漫交织，宛如烛光音乐厅现场。",
    },
    {
      id: "蓝调之音 · 器乐爵士",
      category: "salon",
      sub: "Miles Davis · Coltrane · Ryo Fukui · Glenn Miller",
      seal: "#4d8a88",
      desc: "小号、萨克斯与钢琴三重奏的深夜即兴，兼具冷爵士与大乐队摇摆。",
    },
    {
      id: "灵魂低吟 · 节奏蓝调",
      category: "salon",
      sub: "Bill Withers · Etta James · Sam Cooke · 陶喆",
      seal: "#bc6039",
      desc: "深情滚烫的灵魂乐与节奏布鲁斯经典，直抵人心的律动与嘶吼。",
    },
    {
      id: "先锋浪潮 · 独立摇滚",
      category: "salon",
      sub: "万能青年旅店 · 草东 · 刺猬 · 惘闻 · 回春丹",
      seal: "#5d8b67",
      desc: "当代华语独立乐队、后摇器乐与合成器浪潮，锋利诗意的新声。",
    },
    {
      id: "赤焰岁月 · 华语摇滚",
      category: "salon",
      sub: "崔健 · 唐朝 · 窦唯 · 黑豹 · 二手玫瑰 · 罗大佑",
      seal: "#a8333a",
      desc: "华语摇滚开山火种与时代呐喊，粗粝炽热的经典现场记忆。",
    },
    {
      id: "街巷叙事 · 民谣流行",
      category: "salon",
      sub: "Вадим Казаченко · 暗杠 · 一杯陈豆浆 · 任浩铭",
      seal: "#b89a58",
      desc: "温润质朴的城市民谣与复古流行抒情金曲，适合静夜独酌的街巷故事。",
    },
    {
      id: "古典沙龙 · 剧场礼乐",
      category: "salon",
      sub: "Erik Satie · 肖邦/德彪西/贝多芬 · 卡鲁索/帕瓦罗蒂 · 红军合唱团",
      seal: "#88507c",
      desc: "大提琴钢琴室内乐、旧日俄式及阿根廷探戈、恢弘合唱与庄重礼乐，重现沙龙风华。",
    },
    {
      id: "国歌军乐 · 中国",
      category: "military",
      flag: "🇨🇳",
      sub: "义勇军进行曲 · 歌唱祖国 · 保卫黄河 · 游击队歌",
      seal: "#de2910",
      desc: "巍巍华夏，赤旗飘扬。庄严雄壮的国家颂歌、波澜壮阔的黄河大合唱与嘹亮铿锵的军旅进行曲。",
    },
    {
      id: "国歌军乐 · 美国",
      category: "military",
      flag: "🇺🇸",
      sub: "星条旗之歌 · 星条旗永不落 · 共和国战歌 · 战车向前进",
      seal: "#1e3a8a",
      desc: "雄壮军乐铜管与合唱经典，苏萨经典进行曲与行进战歌，重现历史仪仗风采。",
    },
    {
      id: "国歌军乐 · 俄罗斯",
      category: "military",
      flag: "🇷🇺",
      sub: "牢不可破的联盟 · 神圣的战争 · 告别斯拉夫少女 · 草原啊草原",
      seal: "#991b1b",
      desc: "红旗歌舞团恢弘深沉的男声合唱，二战伟大战火记忆与铜管军礼典范。",
    },
    {
      id: "国歌军乐 · 法国",
      category: "military",
      flag: "🇫🇷",
      sub: "马赛曲 · 游击队之歌 · 洛林进行曲 · 桑布尔与默兹",
      seal: "#1d4ed8",
      desc: "法兰西大革命与反法西斯抵抗运动传世军歌，激昂号角与革命卫队合唱。",
    },
    {
      id: "国歌军乐 · 德国",
      category: "military",
      flag: "🇩🇪",
      sub: "德意志之歌 · 普鲁士荣誉 · 旧友进行曲 · 霍亨弗里德贝格",
      seal: "#4b5563",
      desc: "古典欧洲军乐体系代表作，海顿国歌旋律与严谨宏大的经典步骑兵仪仗军乐。",
    },
    {
      id: "国歌军乐 · 日本",
      category: "military",
      flag: "🇯🇵",
      sub: "君之代 · 军舰进行曲 · 敷岛舰进行曲 · 拔刀队",
      seal: "#b45309",
      desc: "明治与昭和初期黑胶唱片经典行进军乐与雅乐国歌，历史留声机原声重现。",
    },
    {
      id: "国歌军乐 · 英国",
      category: "military",
      flag: "🇬🇧",
      sub: "天佑吾王 · 统治吧不列颠尼亚 · 博吉上校 · 希望与荣耀之地",
      seal: "#1e3a8a",
      desc: "日不落帝国的国歌、海军战歌与近卫军进行曲，铜管号角与爱德华时代唱片的庄严回响。",
    },
    {
      id: "暗夜怪谈 · 模拟恐怖",
      category: "salon",
      flag: "📼",
      sub: "The Caretaker · Al Bowlly · IBM 7094 · Local 58 · 后室 OST",
      seal: "#4c1d95",
      desc: "失真磁带、记忆衰退华尔兹、深夜电视劫持与阈限空间声景交织的模拟恐怖与幽灵舞厅特辑。",
    },
    {
      id: "世界民谣 · 万国乡音",
      category: "salon",
      flag: "🌍",
      sub: "中 · 英 · 苏格兰 · 爱尔兰 · 意 · 日 · 韩 · 法 · 德 · 墨 · 古 · 美",
      seal: "#047857",
      desc: "横跨亚欧与美洲十二国度流传至今的传统民间谣曲，原声吟唱里凝固的山川乡愁与时代记忆。",
    },
    {
      id: "流金热浪 · 时代新声",
      category: "salon",
      flag: "🔥",
      sub: "Die With A Smile · APT. · BIRDS OF A FEATHER · 跳楼机 · 暮色回响",
      seal: "#be123c",
      desc: "2024—2026 席卷全球榜单与短视频热浪的当代高传唱度金曲，汇集欧美冠军单曲与华语人气新作。",
    },
  ];

  // 旧缓存兜底歌手->风格映射(与 .github/gen_music_json.py 保持一致)
  const ARTIST_GENRE_MAP = {
    "billie holiday": "黄金年代 · 爵士名伶",
    "chet baker": "黄金年代 · 爵士名伶",
    "dean martin": "黄金年代 · 爵士名伶",
    "dinah washington": "黄金年代 · 爵士名伶",
    "ella fitzgerald": "黄金年代 · 爵士名伶",
    "ella fitzgerald, paul weston and his orchestra": "黄金年代 · 爵士名伶",
    "etta jones": "黄金年代 · 爵士名伶",
    "john coltrane, johnny hartman": "黄金年代 · 爵士名伶",
    "julie london": "黄金年代 · 爵士名伶",
    "louis armstrong": "黄金年代 · 爵士名伶",
    "peggy lee": "黄金年代 · 爵士名伶",
    "laufey, iceland symphony orchestra": "交响爵士 · 浪漫夜曲",
    "laufey": "交响爵士 · 浪漫夜曲",
    "anthony lazaro": "交响爵士 · 浪漫夜曲",
    "duke ellington, john coltrane": "蓝调之音 · 器乐爵士",
    "glenn miller": "蓝调之音 · 器乐爵士",
    "lester young": "蓝调之音 · 器乐爵士",
    "lester young, oscar peterson trio": "蓝调之音 · 器乐爵士",
    "miles davis, john coltrane, bill evans": "蓝调之音 · 器乐爵士",
    "oliver nelson": "蓝调之音 · 器乐爵士",
    "ryo fukui": "蓝调之音 · 器乐爵士",
    "sidney bechet, muggsy spanier": "蓝调之音 · 器乐爵士",
    "berlioz, ted jasper": "蓝调之音 · 器乐爵士",
    "bill withers": "灵魂低吟 · 节奏蓝调",
    "etta james": "灵魂低吟 · 节奏蓝调",
    "james brown": "灵魂低吟 · 节奏蓝调",
    "sam cooke": "灵魂低吟 · 节奏蓝调",
    "william bell": "灵魂低吟 · 节奏蓝调",
    "david tao": "灵魂低吟 · 节奏蓝调",
    "万能青年旅店": "先锋浪潮 · 独立摇滚",
    "no party for cao dong": "先锋浪潮 · 独立摇滚",
    "刺猬hedgehog": "先锋浪潮 · 独立摇滚",
    "回春丹": "先锋浪潮 · 独立摇滚",
    "海龟先生": "先锋浪潮 · 独立摇滚",
    "蛙池": "先锋浪潮 · 独立摇滚",
    "當代電影大師": "先锋浪潮 · 独立摇滚",
    "wang wen": "先锋浪潮 · 独立摇滚",
    "发光曲线": "先锋浪潮 · 独立摇滚",
    "白紙扇（hardcore raver in tears）": "先锋浪潮 · 独立摇滚",
    "快乐老家": "先锋浪潮 · 独立摇滚",
    "vh (vast & hazy)": "先锋浪潮 · 独立摇滚",
    "ado": "赤焰岁月 · 华语摇滚",
    "black panther": "赤焰岁月 · 华语摇滚",
    "dou wei": "赤焰岁月 · 华语摇滚",
    "second hand rose": "赤焰岁月 · 华语摇滚",
    "tang dynasty": "赤焰岁月 · 华语摇滚",
    "wang feng": "赤焰岁月 · 华语摇滚",
    "xtx (xie tianxiao)": "赤焰岁月 · 华语摇滚",
    "xu wei": "赤焰岁月 · 华语摇滚",
    "反光镜乐队": "赤焰岁月 · 华语摇滚",
    "崔健": "赤焰岁月 · 华语摇滚",
    "羅大佑": "赤焰岁月 · 华语摇滚",
    "陳明章, 王明輝": "赤焰岁月 · 华语摇滚",
    "暗杠": "街巷叙事 · 民谣流行",
    "一杯陈豆浆": "街巷叙事 · 民谣流行",
    "任浩铭, 黄勇": "街巷叙事 · 民谣流行",
    "вадим казаченко": "街巷叙事 · 民谣流行",
    "benny martin/the wong janice": "古典沙龙 · 剧场礼乐",
    "carlos gardel": "古典沙龙 · 剧场礼乐",
    "erik satie/philippe entremont": "古典沙龙 · 剧场礼乐",
    "francis shaw": "古典沙龙 · 剧场礼乐",
    "mandela catalogue": "暗夜怪谈 · 模拟恐怖",
    "the caretaker": "暗夜怪谈 · 模拟恐怖",
    "al bowlly, sid phillips": "暗夜怪谈 · 模拟恐怖",
    "al bowlly, ray noble": "暗夜怪谈 · 模拟恐怖",
    "ibm 7094 (max mathews)": "暗夜怪谈 · 模拟恐怖",
    "kane pixels": "暗夜怪谈 · 模拟恐怖",
    "local 58 (kris straub)": "暗夜怪谈 · 模拟恐怖",
    "instupendo": "暗夜怪谈 · 模拟恐怖",
    "a silver mt. zion": "暗夜怪谈 · 模拟恐怖",
    "北京天使合唱团": "世界民谣 · 万国乡音",
    "jay kiernan, liz hollister": "世界民谣 · 万国乡音",
    "frank munn": "世界民谣 · 万国乡音",
    "simon & garfunkel": "世界民谣 · 万国乡音",
    "milva": "世界民谣 · 万国乡音",
    "yuko takahashi": "世界民谣 · 万国乡音",
    "youn sun nah (罗玧宣)": "世界民谣 · 万国乡音",
    "tino rossi": "世界民谣 · 万国乡音",
    "richard tauber": "世界民谣 · 万国乡音",
    "pedro infante": "世界民谣 · 万国乡音",
    "cuban traditional": "世界民谣 · 万国乡音",
    "josh white": "世界民谣 · 万国乡音",
    "lady gaga, bruno mars": "流金热浪 · 时代新声",
    "rosé, bruno mars": "流金热浪 · 时代新声",
    "billie eilish": "流金热浪 · 时代新声",
    "kendrick lamar, sza": "流金热浪 · 时代新声",
    "alex warren": "流金热浪 · 时代新声",
    "lbi利比": "流金热浪 · 时代新声",
    "吉星出租": "流金热浪 · 时代新声",
    "承桓": "流金热浪 · 时代新声",
    "温奕心": "流金热浪 · 时代新声",
    "张碧晨, 杨坤": "流金热浪 · 时代新声",
    "pyotr leshchenko": "古典沙龙 · 剧场礼乐",
    "the red army choir": "古典沙龙 · 剧场礼乐",
    "юрий щербаков": "古典沙龙 · 剧场礼乐",
    "美国国歌": "古典沙龙 · 剧场礼乐",
    "feodor chaliapin": "古典沙龙 · 剧场礼乐",
    "enrico caruso": "古典沙龙 · 剧场礼乐",
    "enrico caruso, alma gluck": "古典沙龙 · 剧场礼乐",
    "luciano pavarotti": "古典沙龙 · 剧场礼乐",
    "arthur rubinstein": "古典沙龙 · 剧场礼乐",
    "claude debussy": "古典沙龙 · 剧场礼乐",
    "ludwig van beethoven": "古典沙龙 · 剧场礼乐",
    "antonio vivaldi": "古典沙龙 · 剧场礼乐",
    "中国人民解放军军乐团": "国歌军乐 · 中国",
    "中央乐团合唱团": "国歌军乐 · 中国",
    "中国人民解放军总政歌舞团": "国歌军乐 · 中国",
    "百代唱片 (pathé records)": "国歌军乐 · 中国",
    "中国人民解放军": "国歌军乐 · 中国",
    "八路军战士合唱团": "国歌军乐 · 中国",
    "粤语合唱团": "国歌军乐 · 中国",
    "the united states military ensemble": "国歌军乐 · 美国",
    "john philip sousa": "国歌军乐 · 美国",
    "the sandpiper chorus": "国歌军乐 · 美国",
    "united states marine band": "国歌军乐 · 美国",
    "united states naval academy band": "国歌军乐 · 美国",
    "русский хор «волга»": "国歌军乐 · 俄罗斯",
    "хор и оркестр": "国歌军乐 · 俄罗斯",
    "arturo toscanini, nbc symphony orchestra": "国歌军乐 · 俄罗斯",
    "хор": "国歌军乐 · 俄罗斯",
    "военный оркестр": "国歌军乐 · 俄罗斯",
    "le choeur des enfants de montmartre": "国歌军乐 · 法国",
    "germaine sablon": "国歌军乐 · 法国",
    "georges thill, musique de la garde républicaine": "国歌军乐 · 法国",
    "musique de la garde républicaine": "国歌军乐 · 法国",
    "pierre d'assy": "国歌军乐 · 法国",
    "odeon orchestra (leopold stokowski)": "国歌军乐 · 法国",
    "michel nowak ensemble": "国歌军乐 · 德国",
    "berliner harmonie orchester": "国歌军乐 · 德国",
    "carl teike": "国歌军乐 · 德国",
    "trompeterkorps des kavallerie-regiments 6": "国歌军乐 · 德国",
    "josef franz wagner": "国歌军乐 · 德国",
    "herms niel (german march)": "国歌军乐 · 德国",
    "historische aufnahme": "国歌军乐 · 德国",
    "blasorchester": "国歌军乐 · 德国",
    "historische aufnahme 1901": "国歌军乐 · 德国",
    "日本典礼合唱团": "国歌军乐 · 日本",
    "濑户口藤吉": "国歌军乐 · 日本",
    "夏尔·勒鲁": "国歌军乐 · 日本",
    "imperial ensemble": "国歌军乐 · 日本",
    "陸軍戸山学校軍楽隊": "国歌军乐 · 日本",
    "columbia orchestra": "国歌军乐 · 日本",
    "帝国海軍軍楽隊": "国歌军乐 · 日本",
    "帝国海軍軍楽隊 (1909)": "国歌军乐 · 日本",
    "band of the grenadier guards": "国歌军乐 · 英国",
    "military band": "国歌军乐 · 英国",
    "f. j. ricketts (kenneth j. alford)": "国歌军乐 · 英国",
    "dame clara butt": "国歌军乐 · 英国",
  };

  // 同名/共享歌手曲目的文件名级风格映射(确保本地旧缓存与 GitHub API 兜底时 100% 精确归类)
  const FILENAME_GENRE_MAP = {
    // 国歌军乐 · 中国 (10)
    "中国人民解放军军乐团 - 义勇军进行曲 (中华人民共和国国歌).mp3": "国歌军乐 · 中国",
    "中央乐团合唱团 - 歌唱祖国.mp3": "国歌军乐 · 中国",
    "中央乐团合唱团 - 保卫黄河.mp3": "国歌军乐 · 中国",
    "中国人民解放军总政歌舞团 - 游击队歌.mp3": "国歌军乐 · 中国",
    "中央乐团合唱团 - 我们走在大路上.mp3": "国歌军乐 · 中国",
    "百代唱片 (Pathé Records) - 义勇军进行曲 (1935年原版唱片).mp3": "国歌军乐 · 中国",
    "中国人民解放军 - 东方红 (1963年录音).mp3": "国歌军乐 · 中国",
    "八路军战士合唱团 - 八路军进行曲 (1939年原始录音).mp3": "国歌军乐 · 中国",
    "中国人民解放军军乐团 - 义勇军进行曲 (1978-1982年版).mp3": "国歌军乐 · 中国",
    "粤语合唱团 - 义勇军进行曲 (粤语版).mp3": "国歌军乐 · 中国",

    // 国歌军乐 · 美国 (10)
    "United States Military Ensemble - The Star-Spangled Banner.mp3": "国歌军乐 · 美国",
    "John Philip Sousa - The Stars and Stripes Forever.mp3": "国歌军乐 · 美国",
    "The Sandpiper Chorus - Battle Hymn of the Republic.mp3": "国歌军乐 · 美国",
    "The Sandpiper Chorus - The Marines' Hymn (Halls of Montezuma).mp3": "国歌军乐 · 美国",
    "The Sandpiper Chorus - The Caissons Go Rolling Along.mp3": "国歌军乐 · 美国",
    "United States Marine Band - Semper Fidelis (永远忠诚).mp3": "国歌军乐 · 美国",
    "United States Marine Band - The Washington Post (华盛顿邮报进行曲).mp3": "国歌军乐 · 美国",
    "United States Marine Band - The Liberty Bell (自由钟进行曲).mp3": "国歌军乐 · 美国",
    "United States Marine Band - El Capitan (上尉进行曲).mp3": "国歌军乐 · 美国",
    "United States Naval Academy Band - Anchors Aweigh (起锚歌 - 海军军歌).mp3": "国歌军乐 · 美国",

    // 国歌军乐 · 俄罗斯 (10)
    "The Red Army Choir - State Anthem of the Soviet Union.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - The Sacred War (Священная война).mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Farewell of Slavianka.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Polyushko-polye.mp3": "国歌军乐 · 俄罗斯",
    "The Red Army Choir - Along the Vales and Hills.mp3": "国歌军乐 · 俄罗斯",
    "Русский хор «Волга» - Варшавянка (华沙工人歌).mp3": "国歌军乐 · 俄罗斯",
    "Хор и оркестр - Марш энтузиастов (热情者进行曲).mp3": "国歌军乐 · 俄罗斯",
    "Arturo Toscanini, NBC Symphony Orchestra - Интернационал (国际歌 - 1944).mp3": "国歌军乐 · 俄罗斯",
    "Хор - Рабочая Марсельеза (工人马赛曲).mp3": "国歌军乐 · 俄罗斯",
    "Военный оркестр - Старинный марш «Герой» (英雄古老进行曲).mp3": "国歌军乐 · 俄罗斯",

    // 国歌军乐 · 法国 (10)
    "Le Choeur des Enfants de Montmartre - La Marseillaise.mp3": "国歌军乐 · 法国",
    "Germaine Sablon - Le Chant des Partisans.mp3": "国歌军乐 · 法国",
    "Le Choeur des Enfants de Montmartre - Marche Lorraine.mp3": "国歌军乐 · 法国",
    "Le Choeur des Enfants de Montmartre - Le Regiment de Sambre et Meuse.mp3": "国歌军乐 · 法国",
    "Le Choeur des Enfants de Montmartre - Le Chant des Girondins.mp3": "国歌军乐 · 法国",
    "Georges Thill, Musique de la Garde Républicaine - La Marseillaise (马赛曲 - 蒂尔演唱版).mp3": "国歌军乐 · 法国",
    "Georges Thill, Musique de la Garde Républicaine - Le Chant du départ (出征之歌).mp3": "国歌军乐 · 法国",
    "Musique de la Garde Républicaine - La Marseillaise (马赛曲 - 共和国卫队军乐版).mp3": "国歌军乐 · 法国",
    "Pierre d'Assy - Le Régiment de Sambre-et-Meuse (1905年唱片).mp3": "国歌军乐 · 法国",
    "Odeon Orchestra (Leopold Stokowski) - Sambre et Meuse (桑布尔与默兹 - 管弦乐版).mp3": "国歌军乐 · 法国",

    // 国歌军乐 · 德国 (10)
    "Michel Nowak Ensemble - Das Lied der Deutschen (Deutschlandlied).mp3": "国歌军乐 · 德国",
    "Berliner Harmonie Orchester - Preussens Gloria.mp3": "国歌军乐 · 德国",
    "Carl Teike - Alte Kameraden.mp3": "国歌军乐 · 德国",
    "Trompeterkorps des Kavallerie-Regiments 6 - Der Hohenfriedberger Marsch.mp3": "国歌军乐 · 德国",
    "Josef Franz Wagner - Unter dem Doppeladler.mp3": "国歌军乐 · 德国",
    "Herms Niel (German March) - Erika (艾丽卡 - 德军行军歌).mp3": "国歌军乐 · 德国",
    "Historische Aufnahme - Die Wacht am Rhein (莱茵河卫兵).mp3": "国歌军乐 · 德国",
    "Blasorchester - Der Königgrätzer Marsch (柯尼希格雷茨进行曲).mp3": "国歌军乐 · 德国",
    "Historische Aufnahme 1901 - Heil dir im Siegerkranz (胜利者桂冠万岁).mp3": "国歌军乐 · 德国",
    "United States Marine Band - Yorckscher Marsch (约克进行曲).mp3": "国歌军乐 · 德国",

    // 国歌军乐 · 日本 (10)
    "日本典礼合唱团 - 君之代 (Kimigayo).mp3": "国歌军乐 · 日本",
    "濑户口藤吉 - 军舰进行曲 (Gunkan Koshinkyoku).mp3": "国歌军乐 · 日本",
    "濑户口藤吉 - 敷岛舰进行曲 (Shikishima March).mp3": "国歌军乐 · 日本",
    "夏尔·勒鲁 - 拔刀队进行曲 (Battotai).mp3": "国歌军乐 · 日本",
    "Imperial Ensemble - Japanese National March.mp3": "国歌军乐 · 日本",
    "陸軍戸山学校軍楽隊 - 分列行進曲 (阅兵分列进行曲).mp3": "国歌军乐 · 日本",
    "陸軍戸山学校軍楽隊 - 雪の進軍 (雪中行军).mp3": "国歌军乐 · 日本",
    "Columbia Orchestra - 露営の歌 (露营之歌).mp3": "国歌军乐 · 日本",
    "帝国海軍軍楽隊 - 海軍記念日を称ふる歌 (海军纪念日颂歌).mp3": "国歌军乐 · 日本",
    "帝国海軍軍楽隊 (1909) - 君が代 ／ 君が代行進曲 (1909年).mp3": "国歌军乐 · 日本",

    // 国歌军乐 · 英国 (5)
    "Band of the Grenadier Guards - God Save the King (天佑吾王 - 英国国歌).mp3": "国歌军乐 · 英国",
    "United States Army Strings - Rule, Britannia! (统治吧，不列颠尼亚).mp3": "国歌军乐 · 英国",
    "Military Band - The British Grenadiers (英国近卫掷弹兵进行曲).mp3": "国歌军乐 · 英国",
    "F. J. Ricketts (Kenneth J. Alford) - Colonel Bogey March (博吉上校进行曲).mp3": "国歌军乐 · 英国",
    "Dame Clara Butt - Land of Hope and Glory (希望与荣耀之地).mp3": "国歌军乐 · 英国",

    // 古典沙龙 · 剧场礼乐 (同名/共享歌手曲目显式锁定)
    "The Red Army Choir - Коробейники (SPOTISAVER).mp3": "古典沙龙 · 剧场礼乐",
    "The Red Army Choir - Katyusha (Катюша).mp3": "古典沙龙 · 剧场礼乐",
    "The Red Army Choir - Kalinka (Калинка).mp3": "古典沙龙 · 剧场礼乐",
    "National Anthem- United States - Star Spangled Banner.mp3": "古典沙龙 · 剧场礼乐",
    "United States of America National Anthem (Instrumental).mp3": "古典沙龙 · 剧场礼乐",

    // 暗夜怪谈 · 模拟恐怖
    "Mandela Catalogue_ Amazing Grace (Full Version).mp3": "暗夜怪谈 · 模拟恐怖",
    "The Caretaker - It's Just a Burning Memory.mp3": "暗夜怪谈 · 模拟恐怖",
    "The Caretaker - Libet's Delay.mp3": "暗夜怪谈 · 模拟恐怖",
    "Al Bowlly, Sid Phillips - Heartaches (1931).mp3": "暗夜怪谈 · 模拟恐怖",
    "Al Bowlly, Ray Noble - Midnight, the Stars and You (1934).mp3": "暗夜怪谈 · 模拟恐怖",
    "IBM 7094 (Max Mathews) - Daisy Bell (Bicycle Built for Two, 1961).mp3": "暗夜怪谈 · 模拟恐怖",
    "Kane Pixels - Cold Floor (The Backrooms OST).mp3": "暗夜怪谈 · 模拟恐怖",
    "Local 58 (Kris Straub) - Contingency (Analog Broadcast).mp3": "暗夜怪谈 · 模拟恐怖",
    "Instupendo - Six Forty Seven.mp3": "暗夜怪谈 · 模拟恐怖",
    "A Silver Mt. Zion - 13 Angels Standing Guard 'Round the Side of Your Bed.mp3": "暗夜怪谈 · 模拟恐怖",

    // 世界民谣 · 万国乡音
    "北京天使合唱团 - 茉莉花 (Jasmine Flower · 中国民谣).mp3": "世界民谣 · 万国乡音",
    "Jay Kiernan, Liz Hollister - Danny Boy (丹尼男孩 · 爱尔兰民谣).mp3": "世界民谣 · 万国乡音",
    "Frank Munn - Loch Lomond (罗梦湖畔 · 苏格兰民谣).mp3": "世界民谣 · 万国乡音",
    "Simon & Garfunkel - Scarborough Fair (斯卡布罗集市 · 英格兰民谣).mp3": "世界民谣 · 万国乡音",
    "Milva - Bella Ciao (啊朋友再见 · 意大利民谣).mp3": "世界民谣 · 万国乡音",
    "Yuko Takahashi - Sakura Sakura (さくらさくら · 日本民谣).mp3": "世界民谣 · 万国乡音",
    "Youn Sun Nah (罗玧宣) - Arirang (아리랑 · 韩国民谣).mp3": "世界民谣 · 万国乡音",
    "Tino Rossi - Le Temps des cerises (樱桃时节 · 法国民谣).mp3": "世界民谣 · 万国乡音",
    "Richard Tauber - In einem kühlen Grunde (山谷清泉 · 德国民谣).mp3": "世界民谣 · 万国乡音",
    "Pedro Infante - Cielito Lindo (美丽的甜心 · 墨西哥民谣).mp3": "世界民谣 · 万国乡音",
    "Cuban Traditional - Guantanamera (关塔那摩姑娘 · 古巴民谣).mp3": "世界民谣 · 万国乡音",
    "Josh White - House of the Rising Sun (日升之屋 · 美国民谣).mp3": "世界民谣 · 万国乡音",

    // 流金热浪 · 时代新声
    "Lady Gaga, Bruno Mars - Die With A Smile.mp3": "流金热浪 · 时代新声",
    "ROSÉ, Bruno Mars - APT.mp3": "流金热浪 · 时代新声",
    "Billie Eilish - BIRDS OF A FEATHER.mp3": "流金热浪 · 时代新声",
    "Kendrick Lamar, SZA - Luther.mp3": "流金热浪 · 时代新声",
    "Alex Warren - Ordinary.mp3": "流金热浪 · 时代新声",
    "LBI利比 - 跳楼机.mp3": "流金热浪 · 时代新声",
    "吉星出租 - 暮色回响.mp3": "流金热浪 · 时代新声",
    "承桓 - 我会等.mp3": "流金热浪 · 时代新声",
    "温奕心 - 一路生花.mp3": "流金热浪 · 时代新声",
    "张碧晨, 杨坤 - 在加纳共和国离婚 (Live).mp3": "流金热浪 · 时代新声",
  };

  const GENRE_RANK = new Map(GENRE_PRESETS.map((g, idx) => [g.id, idx]));
  const GENRE_META = new Map(GENRE_PRESETS.map((g) => [g.id, g]));

  function inferGenre(artist, genre, pathOrUrl) {
    if (pathOrUrl) {
      const s = String(pathOrUrl);
      const fname = s.slice(s.lastIndexOf("/") + 1);
      if (FILENAME_GENRE_MAP[fname]) return FILENAME_GENRE_MAP[fname];
    }
    if (genre) return String(genre);
    if (!artist) return "";
    return ARTIST_GENRE_MAP[String(artist).trim().toLowerCase()] || "";
  }

  function genreRank(g) {
    if (!g) return 999;
    return GENRE_RANK.has(g) ? GENRE_RANK.get(g) : 500;
  }

  function genreCategory(g) {
    const meta = GENRE_META.get(g);
    return meta ? meta.category : "salon";
  }

  function buildSearchKey(t) {
    return [
      t.title || "",
      t.artist || "",
      t.album || "",
      t.genre || "其他典藏",
      t.path || "",
    ].join("\n").toLowerCase();
  }

  function tokenizeQuery(raw) {
    return String(raw || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matchesSearchTokens(key, tokens) {
    for (let i = 0; i < tokens.length; i++) {
      if (key.indexOf(tokens[i]) === -1) return false;
    }
    return true;
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function hashStringPair(h1, h2, str) {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ((c + i) & 0xff), 2246822519) >>> 0;
    }
    return [h1, h2];
  }

  /**
   * 计算馆藏清单与封面的轻量 64-bit 指纹，避免每次启动对全量 166 首曲目做两次 JSON.stringify 对比。
   */
  function hashLibrarySignature(trackList, coverMap) {
    let h1 = 2166136261;
    let h2 = 2654435761;
    const list = trackList || [];
    const cEntries = coverMap instanceof Map ? Array.from(coverMap.entries()) : (Array.isArray(coverMap) ? coverMap : []);
    [h1, h2] = hashStringPair(h1, h2, list.length + ":" + cEntries.length);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      [h1, h2] = hashStringPair(
        h1,
        h2,
        "\x01" + (t.url || "") + "\x02" + (t.title || "") + "\x02" + (t.artist || "") + "\x02" + (t.album || "") + "\x02" + (t.genre || "") + "\x02" + (t.cover || "")
      );
    }
    cEntries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (let i = 0; i < cEntries.length; i++) {
      [h1, h2] = hashStringPair(h1, h2, "\x03" + cEntries[i][0] + "=" + cEntries[i][1]);
    }
    return h1.toString(16) + "-" + h2.toString(16);
  }

  function storageGet(key, fallback) {
    try {
      const v = global.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      global.localStorage.setItem(key, String(value));
    } catch (e) { /* ignore quota */ }
  }

  function setPressedButtonState(el, isOn) {
    if (!el) return;
    el.classList.toggle("on", !!isOn);
    el.setAttribute("aria-pressed", isOn ? "true" : "false");
  }

  function debounce(fn, waitMs) {
    let timer = null;
    function debounced() {
      const ctx = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(ctx, args);
      }, waitMs);
    }
    debounced.cancel = function () {
      clearTimeout(timer);
      timer = null;
    };
    debounced.flush = function () {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        fn.apply(this, arguments);
      }
    };
    return debounced;
  }

  /**
   * 解析浏览器 URL Hash 中的曲目分享直链参数 (#track=...&t=...)。
   */
  function parseTrackShareHash(hashStr) {
    const raw = String(hashStr || "").replace(/^#/, "");
    if (!raw || raw.indexOf("track=") === -1) return null;
    try {
      const params = new URLSearchParams(raw);
      const trackUrl = params.get("track");
      if (!trackUrl) return null;
      const tVal = parseFloat(params.get("t") || "0");
      return {
        url: trackUrl,
        time: isFinite(tVal) && tVal > 0 ? Math.floor(tVal) : 0,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 构建分享用的当前曲目链接（携带时间戳）。
   */
  function buildTrackShareUrl(trackUrl, timeSec) {
    const base = global.location ? (global.location.href.split("#")[0]) : "";
    const params = new URLSearchParams();
    params.set("track", String(trackUrl || ""));
    const sec = Math.max(0, Math.floor(Number(timeSec) || 0));
    if (sec > 0) params.set("t", String(sec));
    return base + "#" + params.toString();
  }

  function legacyCopyText(text) {
    const doc = global.document;
    if (!doc || !doc.body) return false;
    const field = doc.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;inset-block-start:0;opacity:0;pointer-events:none;";
    doc.body.appendChild(field);
    field.select();
    try {
      return !!doc.execCommand("copy");
    } catch (e) {
      return false;
    } finally {
      field.remove();
    }
  }

  /**
   * 安全写入剪贴板：优先使用 Async Clipboard API，失败时回退同步 textarea 复制。
   */
  async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 回退到 legacyCopyText */ }
    return legacyCopyText(text);
  }

  /**
   * 格式化导出标准 LRC 歌词文本（可选合并双语译文）。
   */
  function formatLrcTag(sec) {
    const safe = Math.max(0, Number(sec) || 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const cs = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));
    return "[" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s + "." + (cs < 10 ? "0" : "") + cs + "]";
  }

  function formatLrcExport(track, state, includeTrans) {
    if (!track || !state || !state.lines || !state.lines.length) return "";
    const out = [];
    if (track.title) out.push("[ti:" + track.title + "]");
    if (track.artist) out.push("[ar:" + track.artist + "]");
    if (track.album && track.album.toLowerCase() !== "unknown album") out.push("[al:" + track.album + "]");
    state.lines.forEach((ln) => {
      const prefix = ln.time !== null ? formatLrcTag(ln.time) : "";
      const txt = ln.text || "";
      if (includeTrans && ln.trans) {
        out.push(prefix + txt + " / " + ln.trans);
      } else {
        out.push(prefix + txt);
      }
    });
    return out.join("\n") + "\n";
  }

  ns.catalog = {
    KEYS,
    COLLECTION_FAVORITES,
    COLLECTION_RECENT,
    AUDIO_EXTS,
    IMAGE_EXTS,
    COVER_NAMES,
    MAX_ERROR_STREAK,
    GENRE_PRESETS,
    GENRE_META,
    inferGenre,
    genreRank,
    genreCategory,
    buildSearchKey,
    tokenizeQuery,
    matchesSearchTokens,
    fmtTime,
    hashLibrarySignature,
    storageGet,
    storageSet,
    setPressedButtonState,
    debounce,
    parseTrackShareHash,
    buildTrackShareUrl,
    copyTextToClipboard,
    formatLrcExport,
  };
})(window);
