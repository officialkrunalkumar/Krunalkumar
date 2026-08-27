/* ==========================================================================
   festival-data.js — every festival /festival knows, and how a typed name
   finds one.
   --------------------------------------------------------------------------
   GENERATED, but reviewed by hand. The palettes, greetings and one-line
   descriptions below were researched per region and then put through an
   adversarial cultural-accuracy pass; the corrections it returned are baked
   in. Do not regenerate this file from a model without repeating that pass —
   the failure mode is not a build error, it is greeting somebody incorrectly
   on their own holy day.

   THE GREETINGS ARE THE POINT. "Happy Diwali" is right; "Happy Eid" is not —
   it is "Eid Mubarak". Navratri is "Shubh Navratri", Rosh Hashanah is "Shana
   Tova", Uttarayan is "Kai Po Che!", Bestu Varas is "Saal Mubarak". A page
   that mechanically prefixes "Happy" to a festival name would be worse than
   no page at all, because it would be confidently wrong in front of the
   person it was trying to please. Every greeting here is the phrase a native
   speaker would actually send.

   SOLEMN OBSERVANCES ARE NOT PARTIES. Yom Kippur, Muharram and Qingming are
   in this list because leaving them out means somebody types them and gets
   generic confetti, which is worse. They carry muted palettes, `stars` rather
   than fireworks, and descriptions that say what the day is. If you add an
   observance of mourning or atonement, match that treatment.

   ENGLISH NAMES ARE ALIASES, NOT DISPLAY NAMES. "gujarati new year",
   "tamil new year", "persian new year" and "korean new year" all resolve, but
   what gets shown is Saal Mubarak, Puthandu Vazthukal, Nowruz Mubarak,
   Saehae Bok Manhi Badeuseyo. The authentic greeting is the headline; the
   description underneath carries the English context for anyone who needs it.

   THE FIELD NAMES ARE SHORT (k/n/g/e/b/p/s/a) because there are ninety-odd
   entries and this file is fetched by every visitor to /festival. Expanded to
   readable keys it is about 40% larger for no benefit to anyone but a person
   reading the source, who has this comment instead.

     k  key          n  display name      g  greeting (the headline)
     e  emoji        b  one-line blurb    s  particle style
     p  palette      [primary, secondary, accent, glow]
     a  aliases      pipe-separated, lowercase

   MATCHING IS FUZZY ON PURPOSE. See resolve() at the foot of this file: the
   whole query exactly, then the query with its filler words ("happy",
   "festival", a year) taken off, then each remaining WORD as an exact match,
   then a Levenshtein pass whose tolerance is a capped fraction of the length.
   This is not a nicety. Transliterated festival names have no canonical
   spelling — the owner of this site writes "Bestu Varsh" where the dataset
   says "Bestu Varas" — and enumerating every variant by hand is a losing
   game. Fuzzy matching turns an unbounded problem into a bounded one.

   FUZZY IS NOT THE SAME AS LOOSE, and the difference is the point. Every
   pass here is anchored: whole query, whole word, or a bounded edit distance.
   Substring containment used to be in that list and is deliberately not any
   more — because norm() strips the spaces, "lent" was found inside
   "valentine" and a Christian fast resolved to Valentine's Day. A matcher
   that reaches too far does not fail loudly, it fails politely and in front
   of the person it was trying to please.
   ========================================================================== */

(function () {
  'use strict';

  var DATA = [
  { k: "anniversary", n: "Anniversary", g: "Happy Anniversary", e: "💞",
    b: "Marking another year together and the small daily choices that keep two people close.",
    p: ["#9B1B30", "#D4AF37", "#F2C6C2", "#2B0A1B"],
    s: "petals", r: "Life events", a: "anniversary|happy anniversary|wedding anniversary|marriage anniversary|anniversaire|work anniversary|annivarsary" },
  { k: "bastille-day", n: "Bastille Day", g: "Joyeux 14 Juillet", e: "🇫🇷",
    b: "France's national day, marking the storming of the Bastille with parades, dancing and fireworks.",
    p: ["#0055A4", "#EF4135", "#F0F3F7", "#061A3D"],
    s: "fireworks", r: "Western & global", a: "bastille day|bastille|14 juillet|quatorze juillet|14 july|fete nationale|french national day|la fete nationale" },
  { k: "bestu-varas", n: "Bestu Varas", g: "Saal Mubarak", e: "✨",
    b: "The Gujarati new year, opened the morning after Diwali with fresh ledgers, sweets and house visits.",
    p: ["#F25C26", "#FFC93C", "#FFE39B", "#380A1F"],
    s: "fireworks", r: "India & the subcontinent", a: "bestu varas|bestu varash|besto varas|gujarati new year|nutan varsh|nutan varshabhinandan|saal mubarak|annakut|govardhan puja" },
  { k: "bhai-dooj", n: "Bhai Dooj", g: "Happy Bhai Dooj", e: "🎁",
    b: "Sisters mark their brothers' foreheads and feed them sweets, a promise of care that outlasts the day.",
    p: ["#E23E57", "#F2B705", "#FF9EB5", "#2A0B3E"],
    s: "confetti", r: "India & the subcontinent", a: "bhai dooj|bhaiya dooj|bhai duj|bhai beej|bhau beej|bhratri dwitiya|yama dwitiya" },
  { k: "bihu", n: "Bihu", g: "Bihur Xubhechha", e: "🥁",
    b: "Assam's turn of the seasons, danced to dhol and pepa and marked by gifts of a woven gamosa.",
    p: ["#D62828", "#F5EFE2", "#2E9E4F", "#0D2B33"],
    s: "leaves", r: "India & the subcontinent", a: "bihu|bohag bihu|rongali bihu|magh bihu|bhogali bihu|kati bihu|assamese new year" },
  { k: "buddha-purnima", n: "Buddha Purnima", g: "Happy Vesak", e: "☸️",
    b: "The full moon of the Buddha's birth, awakening and passing, kept with lamps, lotuses and quiet giving.",
    p: ["#F2A03D", "#F7DCC2", "#F191AF", "#0F2A3D"],
    s: "lanterns", r: "India & the subcontinent", a: "buddha purnima|buddha poornima|buddha jayanti|vesak|wesak|vesak day|vaisakha purnima" },
  { k: "chhath-puja", n: "Chhath Puja", g: "Chhathi Maiya Ki Jai", e: "🌅",
    b: "Four days of fasting and offerings to the setting and rising sun, made standing waist-deep in the river.",
    p: ["#FF7A18", "#FFC94D", "#FFE7B3", "#151A52"],
    s: "stars", r: "India & the subcontinent", a: "chhath|chhath puja|chath puja|chhat puja|chhathi|dala chhath|surya shashti" },
  { k: "christmas", n: "Christmas", g: "Merry Christmas", e: "🎄",
    b: "A celebration of the Nativity, shared through carols, evergreen trees, feasting and gifts.",
    p: ["#0F5132", "#C8102E", "#F5C542", "#0B2E1E"],
    s: "snow", r: "Western & global", a: "christmas|xmas|x-mas|merry christmas|christmas day|noel|navidad|weihnachten|natal|christmas eve|crismas|chrismas|krismas" },
  { k: "chuseok", n: "Chuseok", g: "Jeulgeoun Chuseok Bonaeseyo", e: "🌕",
    b: "Korean harvest thanksgiving: songpyeon rice cakes, ancestral rites and a full moon shared with family.",
    p: ["#D98A22", "#8C3B1E", "#F7E3B0", "#2A1408"],
    s: "leaves", r: "East & Southeast Asia", a: "chuseok|chusok|hangawi|korean thanksgiving|korean harvest festival|songpyeon festival" },
  { k: "diwali", n: "Diwali", g: "Happy Diwali", e: "🪔",
    b: "Rows of clay lamps welcome Lakshmi home, marking light's return and the opening of a new ledger year.",
    p: ["#F5A623", "#E0533D", "#FFE1A8", "#140B3C"],
    s: "fireworks", r: "India & the subcontinent", a: "diwali|deepavali|dipavali|divali|deepawali|diwali festival|festival of lights" },
  { k: "dragon-boat-festival", n: "Dragon Boat Festival", g: "Duanwu Ankang", e: "🐉",
    b: "Duanwu honours the poet Qu Yuan with racing dragon boats, sticky-rice zongzi and wishes for good health.",
    p: ["#C0392B", "#126B63", "#E7C556", "#06282A"],
    s: "bubbles", r: "East & Southeast Asia", a: "dragon boat festival|duanwu|duanwu jie|duan wu|tuen ng|zongzi festival|double fifth|dragon boat" },
  { k: "durga-puja", n: "Durga Puja", g: "Shubho Sharodiya", e: "🛕",
    b: "Bengal welcomes Durga home for five days of pandal-hopping, dhak drums, feasting and a river farewell.",
    p: ["#D62828", "#F7E7CE", "#F0A202", "#4A0A16"],
    s: "petals", r: "India & the subcontinent", a: "durga puja|durgapuja|durga pujo|pujo|durga pooja|durgotsav|sharadiya|mahalaya" },
  { k: "dussehra", n: "Dussehra", g: "Happy Dussehra", e: "🏹",
    b: "Ravana's effigy burns at sunset, marking Rama's victory and the tenth day of Durga's triumph.",
    p: ["#FF6B00", "#A4161A", "#FFC94A", "#3B0A05"],
    s: "sparks", r: "India & the subcontinent", a: "dussehra|dasara|dashera|dusshera|dushera|vijayadashami|vijaya dashami|dashain" },
  { k: "earth-day", n: "Earth Day", g: "Happy Earth Day", e: "🌍",
    b: "A worldwide day for looking after the planet, from tree planting to cleaner everyday habits.",
    p: ["#2E8B57", "#1E6091", "#A7D948", "#052A3C"],
    s: "leaves", r: "Western & global", a: "earth day|earthday|world earth day|international earth day|mother earth day|planet day" },
  { k: "easter", n: "Easter", g: "Happy Easter", e: "🐣",
    b: "The Christian celebration of resurrection and spring renewal, marked with eggs, flowers and family feasts.",
    p: ["#F7A8CE", "#A8E6CF", "#FFE066", "#2E1B47"],
    s: "petals", r: "Western & global", a: "easter|easter sunday|happy easter|pascha|pasch|paques|ostern|pasqua|resurrection sunday" },
  { k: "eid-al-adha", n: "Eid al-Adha", g: "Eid Mubarak", e: "🕋",
    b: "The Feast of Sacrifice honours Ibrahim's devotion, with prayer and sharing meat with family and those in need.",
    p: ["#14532D", "#8A5A2B", "#D4AF37", "#06231A"],
    s: "stars", r: "Islamic & Jewish", a: "eid al-adha|eid al adha|eid ul adha|eid-ul-adha|bakrid|bakra eid|qurbani eid|greater eid|feast of sacrifice|hari raya haji|kurban bayrami|idul adha|eid e qurban|eid ul zuha|eid-ul-zuha|id-ul-zuha|badi eid|bakri eid|hari raya korban" },
  { k: "eid-al-fitr", n: "Eid al-Fitr", g: "Eid Mubarak", e: "🕌",
    b: "Marks the end of Ramadan's month of fasting with prayer, charity and joyful feasting with family.",
    p: ["#10375C", "#1B8A5A", "#E8C56A", "#071C33"],
    s: "stars", r: "Islamic & Jewish", a: "eid|eid al-fitr|eid al fitr|eid ul fitr|eid-ul-fitr|eid ul-fitr|eid mubarak|ramzan eid|ramadan eid|sweet eid|hari raya aidilfitri|hari raya|lebaran|ramazan bayrami|idul fitri|eid el fitr|choti eid|meethi eid|hari raya puasa|seker bayrami|raya" },
  { k: "eid-milad", n: "Eid Milad-un-Nabi", g: "Eid Milad un Nabi Mubarak", e: "🌟",
    b: "South Asian observance of the Prophet Muhammad's birth, with processions, naats and giving to the poor.",
    p: ["#0E7C86", "#0B3B4A", "#F3D98B", "#04222A"],
    s: "lanterns", r: "Islamic & Jewish", a: "eid milad|eid milad un nabi|eid milad-un-nabi|milad un nabi|milad-un-nabi|eid-e-milad|jashn-e-eid-milad|barawafat|bara wafat|nabi day|12 rabi ul awal" },
  { k: "engagement", n: "Engagement", g: "Congratulations on the Engagement", e: "💍",
    b: "A promise made and a wedding to plan, celebrated with rings, hugs and a few happy tears.",
    p: ["#E0A899", "#C9B037", "#DDE7F0", "#2B1524"],
    s: "sparks", r: "Life events", a: "engagement|engaged|got engaged|just engaged|betrothal|proposal|proposed|she said yes|roka|sagai|mangni" },
  { k: "fathers-day", n: "Father's Day", g: "Happy Father's Day", e: "👔",
    b: "A day to honour fathers and father figures for their steadiness, humour and quiet care.",
    p: ["#1F6FB2", "#2E4053", "#E8B04B", "#0B1E33"],
    s: "stars", r: "Western & global", a: "fathers day|father's day|fathersday|father day|fathers|dad day|papa day|happy fathers day|pitru divas" },
  { k: "friendship-day", n: "Friendship Day", g: "Happy Friendship Day", e: "🤝",
    b: "A day to celebrate the friends who become chosen family, with messages, bands and reunions.",
    p: ["#FFB300", "#2EC4B6", "#FF6B6B", "#0E2B33"],
    s: "confetti", r: "Western & global", a: "friendship day|friendship|friends day|friendsday|happy friendship day|international friendship day|international day of friendship|best friends day" },
  { k: "ganesh-chaturthi", n: "Ganesh Chaturthi", g: "Ganpati Bappa Morya", e: "🐘",
    b: "Ganesha comes home for ten days of modaks, aarti and drums, then is carried to the water to leave.",
    p: ["#F4511E", "#C1272D", "#FFD166", "#3A0C10"],
    s: "petals", r: "India & the subcontinent", a: "ganesh chaturthi|ganesha chaturthi|ganesh chathurthi|ganeshotsav|ganesh utsav|ganpati|vinayaka chaturthi|vinayagar chaturthi" },
  { k: "graduation", n: "Graduation", g: "Congratulations", e: "🎓",
    b: "The moment years of study turn into a milestone, marked with caps, gowns and proud applause.",
    p: ["#1D3557", "#457B9D", "#F1C40F", "#0A1730"],
    s: "confetti", r: "Life events", a: "graduation|graduated|grad|graduating|convocation|commencement|degree|passed out|class of" },
  { k: "gudi-padwa", n: "Gudi Padwa", g: "Gudi Padwyachya Hardik Shubhechha", e: "🚩",
    b: "Maharashtra's new year, when a silk-draped gudi is raised at the doorway to invite a good year in.",
    p: ["#FF7A1A", "#1B998B", "#E0B341", "#3A0B22"],
    s: "petals", r: "India & the subcontinent", a: "gudi padwa|gudhi padwa|gudipadwa|gudhipadva|padwa|marathi new year|samvatsar padvo" },
  { k: "gurpurab", n: "Gurpurab", g: "Happy Gurpurab", e: "🪯",
    b: "The birth of Guru Nanak, marked with all-night readings, kirtan, langar and lamps at the gurdwara.",
    p: ["#F0A81F", "#F26B0F", "#FFE6B0", "#08213F"],
    s: "lanterns", r: "India & the subcontinent", a: "gurpurab|gurpurb|guru purab|guru nanak jayanti|guru nanak gurpurab|guru nanak birthday|prakash purab|prakash parv" },
  { k: "guru-purnima", n: "Guru Purnima", g: "Happy Guru Purnima", e: "🙏",
    b: "The full moon for thanking teachers, from the first guru at home to the ones who shaped a life.",
    p: ["#F0A22E", "#E8EDF5", "#FFD37A", "#191540"],
    s: "stars", r: "India & the subcontinent", a: "guru purnima|guru poornima|gurupurnima|vyasa purnima|ashadha purnima" },
  { k: "halloween", n: "Halloween", g: "Happy Halloween", e: "🎃",
    b: "An autumn night of costumes, carved pumpkins and trick-or-treating with a friendly touch of the spooky.",
    p: ["#FF7518", "#4B0082", "#9BE564", "#140A1F"],
    s: "sparks", r: "Western & global", a: "halloween|hallowe'en|haloween|hallowen|all hallows eve|all hallows' eve|spooky night|trick or treat" },
  { k: "hanami", n: "Hanami", g: "Hanami: Sakura in Bloom", e: "🌸",
    b: "Japan's cherry-blossom season, spent picnicking beneath pink petals that bloom brilliantly and briefly.",
    p: ["#F2A0BC", "#8E3A63", "#FFE3EC", "#330D26"],
    s: "petals", r: "East & Southeast Asia", a: "hanami|ohanami|cherry blossom|cherry blossom festival|sakura|sakura season|blossom viewing|sakura matsuri" },
  { k: "hanukkah", n: "Hanukkah", g: "Happy Hanukkah", e: "🕎",
    b: "Festival of Lights: eight nights of candles, latkes and dreidels recalling the Temple's rededication.",
    p: ["#0F2E63", "#C7D3E3", "#F2C14E", "#071A3C"],
    s: "stars", r: "Islamic & Jewish", a: "hanukkah|chanukah|hanukah|chanukkah|hannukah|chag urim|menorah festival" },
  { k: "hanuman-jayanti", n: "Hanuman Jayanti", g: "Jai Hanuman", e: "⛰️",
    b: "Hanuman's birth, kept with dawn recitations of the Chalisa, sindoor offerings and free meals.",
    p: ["#F25C05", "#D62828", "#FFC24A", "#40140E"],
    s: "sparks", r: "India & the subcontinent", a: "hanuman jayanti|hanumanjayanti|hanuman janmotsav|hanuman janmotsav|anjaneya jayanti|hanuman jyanti" },
  { k: "hijri-new-year", n: "Hijri New Year", g: "Hijri New Year Mubarak", e: "🌙",
    b: "The first day of Muharram opens the Islamic lunar year, marked quietly rather than with celebration.",
    p: ["#1B7F6B", "#0C3A34", "#E8C56A", "#05211C"],
    s: "stars", r: "Islamic & Jewish", a: "hijri new year|islamic new year|arabic new year|muslim new year|ras as-sanah|new year islamic|hijri" },
  { k: "holi", n: "Holi", g: "Happy Holi", e: "🎨",
    b: "Winter ends in a riot of coloured powder, water and forgiveness between friends, neighbours and strangers.",
    p: ["#E6197C", "#12B76A", "#FFD814", "#2A0F4A"],
    s: "colorpuffs", r: "India & the subcontinent", a: "holi|hoili|dhulandi|dhuleti|rangwali holi|holika dahan|festival of colours|festival of colors" },
  { k: "housewarming", n: "Housewarming", g: "Happy Housewarming", e: "🏡",
    b: "Welcoming friends into a new home for the first time and filling its rooms with warmth.",
    p: ["#C46A2F", "#6B8E5A", "#F0C987", "#2A1409"],
    s: "lanterns", r: "Life events", a: "housewarming|house warming|new home|new house|new place|moving in|moved in|griha pravesh|gruhapravesam" },
  { k: "independence-day", n: "Independence Day", g: "Happy Independence Day", e: "🎇",
    b: "A nation's day of freedom, marked with flags, fireworks and pride in how far a people have come.",
    p: ["#C9A227", "#3A6EA5", "#F1E4C3", "#17263F"],
    s: "fireworks", r: "Western & global", a: "independence day|independance day|independence|freedom day|national day|happy independence day|liberation day" },
  { k: "independence-day-india", n: "Independence Day (India)", g: "Happy Independence Day", e: "🪁",
    b: "India's freedom day, remembered with flag hoisting, patriotic songs and skies full of kites.",
    p: ["#138808", "#FF9933", "#FFD75E", "#082B14"],
    s: "stars", r: "India & the subcontinent", a: "independence day india|indian independence day|india independence day|swatantrata diwas|swatantrata divas|azadi|15 august|15th august|august 15" },
  { k: "janmashtami", n: "Janmashtami", g: "Jai Shri Krishna", e: "🦚",
    b: "Krishna's midnight birth, kept with fasting, cradle songs and human pyramids reaching for the dahi handi.",
    p: ["#2D6CDF", "#F6B93B", "#00BFA6", "#0A1440"],
    s: "stars", r: "India & the subcontinent", a: "janmashtami|krishna janmashtami|janmashtmi|gokulashtami|krishnashtami|krishna jayanti|dahi handi" },
  { k: "karva-chauth", n: "Karva Chauth", g: "Happy Karva Chauth", e: "🌕",
    b: "A day-long fast broken only after the moon rises, seen first through a sieve, then a beloved face.",
    p: ["#C2185B", "#E8C36A", "#E6EEF8", "#141042"],
    s: "stars", r: "India & the subcontinent", a: "karva chauth|karwa chauth|karvachauth|karwachauth|karva chowth|karak chaturthi" },
  { k: "kwanzaa", n: "Kwanzaa", g: "Habari Gani", e: "🕯️",
    b: "Seven nights of African-American celebration, lighting the kinara for unity, purpose and community.",
    p: ["#1E7A3C", "#C1121F", "#F0C24B", "#10190F"],
    s: "sparks", r: "Persian & African", a: "kwanzaa|kwanza|habari gani|kinara|seven principles|nguzo saba" },
  { k: "labour-day", n: "Labour Day", g: "Happy Labour Day", e: "🛠️",
    b: "A day honouring workers everywhere and the rights they organised, marched and fought to win.",
    p: ["#C0392B", "#2C3E50", "#F39C12", "#26100C"],
    s: "sparks", r: "Western & global", a: "labour day|labor day|may day|1 may|international workers day|workers day|mazdoor diwas|mazdoor din|labour" },
  { k: "lohri", n: "Lohri", g: "Happy Lohri", e: "🔥",
    b: "Punjab's bonfire night for the last of winter, fed with sesame, jaggery, popcorn and folk songs.",
    p: ["#FF6B1A", "#D62A12", "#FFC24A", "#2A0B03"],
    s: "sparks", r: "India & the subcontinent", a: "lohri|lohari|lohri festival|lohdi" },
  { k: "losar", n: "Losar", g: "Losar Tashi Delek", e: "🪔",
    b: "Tibetan New Year of butter lamps, khapse pastries and prayer flags raised for a fortunate year ahead.",
    p: ["#8C2F27", "#E9A13B", "#2FA3A8", "#2A0C0A"],
    s: "stars", r: "East & Southeast Asia", a: "losar|lhosar|tibetan new year|bhutanese new year|sonam losar|gyalpo losar|tamu losar|tashi delek" },
  { k: "lunar-new-year", n: "Lunar New Year", g: "Happy Lunar New Year", e: "🧧",
    b: "Families reunite for feasts, red envelopes and lion dances to welcome the new lunar year.",
    p: ["#A8121A", "#5E0A10", "#F5C542", "#3A040A"],
    s: "fireworks", r: "East & Southeast Asia", a: "lunar new year|chinese new year|cny|spring festival|chunjie|chun jie|gong xi fa cai|gong hey fat choy|kung hei fat choy|guo nian|xin nian|new year lunar" },
  { k: "maha-shivaratri", n: "Maha Shivaratri", g: "Har Har Mahadev", e: "🔱",
    b: "The great night of Shiva, kept awake with fasting, bilva leaves and chanting until dawn.",
    p: ["#5BC8DC", "#B9C6CC", "#7BD389", "#0B1233"],
    s: "stars", r: "India & the subcontinent", a: "maha shivaratri|mahashivratri|maha shivratri|shivratri|shivaratri|shiv ratri|mahashivaratri" },
  { k: "mahavir-jayanti", n: "Mahavir Jayanti", g: "Jai Jinendra", e: "🪷",
    b: "The birth of Mahavira, remembered by Jains with prayer, charity and a renewed vow of non-violence.",
    p: ["#E8A31E", "#F5F2E9", "#2E9E7A", "#241141"],
    s: "petals", r: "India & the subcontinent", a: "mahavir jayanti|mahaveer jayanti|mahavira jayanti|mahavir janma kalyanak|mahavir jyanti" },
  { k: "makar-sankranti", n: "Makar Sankranti", g: "Happy Makar Sankranti", e: "🌞",
    b: "The sun turns north into Makara, and the harvest is met with sesame-jaggery sweets and open skies.",
    p: ["#FF8A00", "#FFC93C", "#4FC3F7", "#1A1B4B"],
    s: "sparks", r: "India & the subcontinent", a: "makar sankranti|makara sankranti|makarsankranti|sankranti|sankranthi|til sankrant|maghi|khichdi parv" },
  { k: "mardi-gras", n: "Carnival / Mardi Gras", g: "Happy Mardi Gras", e: "🎭",
    b: "The last exuberant carnival before Lent, full of parades, masks, beads and street music.",
    p: ["#6A0DAD", "#009E60", "#FFD700", "#240A3D"],
    s: "confetti", r: "Western & global", a: "mardi gras|mardigras|carnival|carnaval|karneval|fasching|fat tuesday|shrove tuesday|pancake day|rio carnival" },
  { k: "mawlid", n: "Mawlid al-Nabi", g: "Mawlid Mubarak", e: "📿",
    b: "Marks the birth of the Prophet Muhammad with recitation, praise poetry and acts of charity.",
    p: ["#0F6B4A", "#0B3B2E", "#E9C46A", "#05241A"],
    s: "lanterns", r: "Islamic & Jewish", a: "mawlid|mawlid al-nabi|mawlid an-nabi|maulid|mevlid|mevlit|maulidur rasul|prophet's birthday|birthday of the prophet|molid" },
  { k: "mid-autumn-festival", n: "Mid-Autumn Festival", g: "Zhongqiu Kuaile", e: "🥮",
    b: "Families gather under the year's fullest moon to share mooncakes and carry glowing lanterns.",
    p: ["#F2D479", "#2E6B5E", "#FFF4CF", "#08182B"],
    s: "lanterns", r: "East & Southeast Asia", a: "mid-autumn festival|mid autumn festival|mooncake festival|zhongqiu|zhong qiu jie|moon festival|tsukimi|trung thu|tet trung thu|jungchu" },
  { k: "midsummer", n: "Midsummer", g: "Happy Midsummer", e: "🌻",
    b: "The Nordic welcome to the longest day, with flower crowns, maypoles and light that never quite fades.",
    p: ["#5FA85A", "#FFD447", "#8FD3F4", "#10323F"],
    s: "petals", r: "Western & global", a: "midsummer|midsommar|mid summer|summer solstice|solstice|litha|juhannus|sankt hans|st johns day|jaanipaev" },
  { k: "mothers-day", n: "Mother's Day", g: "Happy Mother's Day", e: "💐",
    b: "A day to thank mothers and mother figures for the care they quietly give all year round.",
    p: ["#C86B98", "#F7C9DC", "#FFE7A3", "#2E1030"],
    s: "petals", r: "Western & global", a: "mothers day|mother's day|mothersday|mother day|mothers|mom day|mum day|happy mothers day|matru divas" },
  { k: "muharram", n: "Muharram and Ashura", g: "Muharram: A Month of Remembrance", e: "🤲",
    b: "First month of the Islamic year; Ashura is marked by fasting and by mourning for Hussain at Karbala.",
    p: ["#14161C", "#4A5568", "#9AA7B8", "#0B1015"],
    s: "stars", r: "Islamic & Jewish", a: "muharram|ashura|aashura|ashoora|moharram|muharram ul haram|karbala|yaum al-ashura|youm e ashura|azadari", x: 1 },
  { k: "navratri", n: "Navratri", g: "Shubh Navratri", e: "💃",
    b: "Nine nights of devotion to Durga, danced out in circling garba and dandiya until the small hours.",
    p: ["#FF2E63", "#FFB627", "#00C9A7", "#33094C"],
    s: "sparks", r: "India & the subcontinent", a: "navratri|navaratri|navratra|navrathri|navaratra|garba|sharad navratri|chaitra navratri" },
  { k: "navroz", n: "Navroz", g: "Navroz Mubarak", e: "🌹",
    b: "The Parsi new year, welcomed with prayers at the fire temple, a scented home and a table of good omens.",
    p: ["#16B5C0", "#E8B33D", "#F2748C", "#052836"],
    s: "petals", r: "India & the subcontinent", a: "navroz|navroze|nauroz|nowruz|norooz|parsi new year|jamshedi navroz|pateti" },
  { k: "new-job", n: "New Job", g: "Congrats on the New Job", e: "💼",
    b: "A fresh start, a new desk and the excitement of everything still left to learn.",
    p: ["#0E7C7B", "#1F3A5F", "#F2B705", "#062A2A"],
    s: "confetti", r: "Life events", a: "new job|newjob|new role|new position|got the job|first day|job offer|promotion|career move|new gig" },
  { k: "new-year", n: "New Year", g: "Happy New Year", e: "🎆",
    b: "The turning of the calendar, welcomed with countdowns, fireworks and hopeful resolutions.",
    p: ["#F5C518", "#3A4FB0", "#EDE7FF", "#10143C"],
    s: "fireworks", r: "Western & global", a: "new year|new years|new year's|newyear|happy new year|nye|new years eve|new year's eve|january 1|1 january" },
  { k: "nowruz", n: "Nowruz", g: "Nowruz Mubarak", e: "🌱",
    b: "Persian New Year at the spring equinox: the haft-sin table, sprouting greens and renewal after winter.",
    p: ["#2E9E6B", "#1FA8B8", "#E8C15A", "#06322C"],
    s: "petals", r: "Persian & African", a: "nowruz|norooz|noruz|nawruz|navroz|navroze|nauroz|newroz|no ruz|persian new year|iranian new year|eid-e nowruz|haft sin|navruz|novruz|nooruz|nauryz|nowrooz" },
  { k: "obon", n: "Obon", g: "Obon: Welcoming the Ancestors", e: "🏮",
    b: "Japan's summer rite welcoming ancestors home with lantern fires, bon odori dancing and floating lights.",
    p: ["#E2542B", "#141F3A", "#FFC07A", "#060D1E"],
    s: "lanterns", r: "East & Southeast Asia", a: "obon|o-bon|bon festival|bon odori|urabon|japanese festival of the dead|toro nagashi", x: 1 },
  { k: "oktoberfest", n: "Oktoberfest", g: "Prost!", e: "🍺",
    b: "Munich's great autumn folk festival of beer tents, brass bands, pretzels and lederhosen.",
    p: ["#0057B7", "#E3B23C", "#F2EFE6", "#06214A"],
    s: "bubbles", r: "Western & global", a: "oktoberfest|october fest|octoberfest|oktober fest|wiesn|beer festival|munich beer festival|prost" },
  { k: "onam", n: "Onam", g: "Onashamsakal", e: "🌺",
    b: "Kerala welcomes King Mahabali back with flower carpets, boat races and the many dishes of the Onam sadya.",
    p: ["#F2A20C", "#E4572E", "#23C08A", "#063B22"],
    s: "petals", r: "India & the subcontinent", a: "onam|thiruvonam|onam festival|pookalam|onasadya" },
  { k: "passover", n: "Passover (Pesach)", g: "Chag Pesach Sameach", e: "🍷",
    b: "Pesach recalls the Exodus from Egypt with the seder, matzah and the retelling of the journey to freedom.",
    p: ["#7B2233", "#1E3A5F", "#E3C88B", "#2A0C14"],
    s: "stars", r: "Islamic & Jewish", a: "passover|pesach|pesah|peysakh|chag pesach|seder|feast of unleavened bread" },
  { k: "poila-boishakh", n: "Poila Boishakh", g: "Shubho Noboborsho", e: "🎊",
    b: "The Bengali new year, begun with new clothes, sweet curd, fresh halkhata ledgers and morning song.",
    p: ["#D2402E", "#F7EFE2", "#F2A93B", "#45140B"],
    s: "petals", r: "India & the subcontinent", a: "poila boishakh|pohela boishakh|poila baisakh|pohela baishakh|noboborsho|nabo barsha|bengali new year|subho noboborsho" },
  { k: "pongal", n: "Pongal", g: "Happy Pongal", e: "🍚",
    b: "Tamil harvest thanksgiving: fresh rice boils over a clay pot in the sun and everyone calls out as it does.",
    p: ["#F2B705", "#2E9E63", "#FF7A29", "#35190A"],
    s: "leaves", r: "India & the subcontinent", a: "pongal|thai pongal|thaipongal|ponggal|mattu pongal|pongal festival" },
  { k: "pride", n: "Pride", g: "Happy Pride", e: "🏳️‍🌈",
    b: "A celebration of LGBTQ+ lives, love and visibility, born from protest and carried by community.",
    p: ["#E40303", "#004DFF", "#FFED00", "#2A0A3D"],
    s: "confetti", r: "Western & global", a: "pride|pride month|pride day|happy pride|lgbtq pride|lgbt pride|lgbtqia pride|gay pride|rainbow pride|queer pride" },
  { k: "purim", n: "Purim", g: "Chag Purim Sameach", e: "🎭",
    b: "Joyful festival of costumes, hamantaschen and the Megillah, recalling Esther's rescue of her people.",
    p: ["#7B3FA0", "#E0483C", "#F2C64B", "#2A0F3E"],
    s: "confetti", r: "Islamic & Jewish", a: "purim|chag purim|feast of lots|megillah|esther festival" },
  { k: "puthandu", n: "Puthandu", g: "Puthandu Vazthukal", e: "🥭",
    b: "The Tamil new year, greeted with a kanni tray of good things and the six tastes of mangai pachadi.",
    p: ["#F2A413", "#C43E1C", "#7CB518", "#16300F"],
    s: "leaves", r: "India & the subcontinent", a: "puthandu|puthandu vazthukal|tamil new year|varusha pirappu|chithirai new year|puthaandu" },
  { k: "qingming", n: "Qingming Festival", g: "Qingming: Remembering Those Before Us", e: "🍃",
    b: "Tomb-Sweeping Day: families tend ancestors' graves, offer flowers and remember those who came before.",
    p: ["#5F7A63", "#8C9AA3", "#CFDAD2", "#101A16"],
    s: "petals", r: "East & Southeast Asia", a: "qingming|ching ming|qing ming|tomb sweeping day|tomb-sweeping day|grave sweeping day|ancestors day|cheng beng", x: 1 },
  { k: "raksha-bandhan", n: "Raksha Bandhan", g: "Happy Raksha Bandhan", e: "🎀",
    b: "A sister ties a thread on her brother's wrist, and he promises to look out for her, always.",
    p: ["#EF476F", "#FFC145", "#FFB3C6", "#3A0B2E"],
    s: "petals", r: "India & the subcontinent", a: "raksha bandhan|rakshabandhan|raksha bandan|rakshabandan|rakhi|rakhi purnima|rakhi festival" },
  { k: "ram-navami", n: "Ram Navami", g: "Jai Shri Ram", e: "🕉️",
    b: "Rama's birth at noon, marked with readings of the Ramayana, processions and sweetened panakam.",
    p: ["#FF7A00", "#B3202C", "#FFDD8A", "#3B0F1E"],
    s: "petals", r: "India & the subcontinent", a: "ram navami|rama navami|ramnavami|ram navmi|sri rama navami|ramnavmi" },
  { k: "ramadan", n: "Ramadan", g: "Ramadan Mubarak", e: "🌙",
    b: "A holy month of dawn-to-sunset fasting, prayer, reflection and generosity across the Muslim world.",
    p: ["#1B2A4A", "#8FA3C4", "#E3B84A", "#0A1428"],
    s: "lanterns", r: "Islamic & Jewish", a: "ramadan|ramzan|ramadhan|ramazan|ramadan kareem|ramadan mubarak|month of fasting|roza|sawm" },
  { k: "ratha-yatra", n: "Ratha Yatra", g: "Jai Jagannath", e: "🛞",
    b: "Jagannath, Balabhadra and Subhadra ride out from Puri on towering wooden chariots pulled by hand.",
    p: ["#E8412C", "#F5C518", "#14A38B", "#33091A"],
    s: "confetti", r: "India & the subcontinent", a: "rath yatra|ratha yatra|rathyatra|jagannath rath yatra|puri rath yatra|chariot festival" },
  { k: "republic-day-india", n: "Republic Day (India)", g: "Happy Republic Day", e: "🇮🇳",
    b: "India marks the day its Constitution came into force, with a grand parade and tricolour everywhere.",
    p: ["#FF9933", "#138808", "#FFFFFF", "#0A1240"],
    s: "confetti", r: "India & the subcontinent", a: "republic day|republic day india|indian republic day|gantantra diwas|ganatantra diwas|26 january|26th january|january 26" },
  { k: "rosh-hashanah", n: "Rosh Hashanah", g: "Shana Tova", e: "🍎",
    b: "The Jewish New Year, welcomed with the shofar's call, apples dipped in honey and hopes for a sweet year.",
    p: ["#E0A63F", "#123A6B", "#F6E0A8", "#0B1E42"],
    s: "stars", r: "Islamic & Jewish", a: "rosh hashanah|rosh hashana|rosh hashannah|jewish new year|shana tova|yom teruah|head of the year" },
  { k: "seollal", n: "Seollal", g: "Saehae Bok Manhi Badeuseyo", e: "🍲",
    b: "Korean Lunar New Year of ancestral rites, tteokguk rice-cake soup and deep bows of respect to elders.",
    p: ["#1E56A0", "#C8102E", "#F2C14E", "#08203F"],
    s: "petals", r: "East & Southeast Asia", a: "seollal|sollal|korean new year|seolnal|korean lunar new year|saehae|tteokguk day" },
  { k: "shogatsu", n: "Shogatsu", g: "Akemashite Omedetou Gozaimasu", e: "🎍",
    b: "Japan's New Year: temple bells at midnight, osechi boxes, a first shrine visit and wishes for the year.",
    p: ["#D12A2F", "#EFE9DC", "#D9B451", "#2B0A10"],
    s: "stars", r: "East & Southeast Asia", a: "shogatsu|shougatsu|oshogatsu|japanese new year|ganjitsu|gantan|hatsumode|akemashite omedetou" },
  { k: "songkran", n: "Songkran", g: "Sawasdee Pee Mai", e: "🌊",
    b: "Thai New Year of water blessings, temple visits and pouring scented water over elders' hands.",
    p: ["#2AA7C4", "#F2A03D", "#F7E08A", "#06303F"],
    s: "bubbles", r: "East & Southeast Asia", a: "songkran|song kran|thai new year|water festival|sawasdee pee mai|songkran festival" },
  { k: "st-patricks-day", n: "St Patrick's Day", g: "Happy St Patrick's Day", e: "☘️",
    b: "Ireland's national day, celebrated worldwide with parades, music, shamrocks and a sea of green.",
    p: ["#009A44", "#FF883E", "#F4D03F", "#03291A"],
    s: "confetti", r: "Western & global", a: "st patricks day|st patrick's day|saint patricks day|saint patrick's day|st paddys day|st pattys day|paddys day|patricks day|shamrock day" },
  { k: "sukkot", n: "Sukkot", g: "Chag Sukkot Sameach", e: "🌿",
    b: "Seven days spent in leafy sukkahs with lulav and etrog, giving thanks for harvest and for shelter.",
    p: ["#3F7D3C", "#C8791F", "#E8C46B", "#10250F"],
    s: "leaves", r: "Islamic & Jewish", a: "sukkot|succot|sukkos|feast of tabernacles|feast of booths|chag sukkot|sukkah festival" },
  { k: "teachers-day", n: "Teachers' Day", g: "Happy Teachers' Day", e: "🍎",
    b: "A day to thank the teachers who shaped how we think, question and keep on learning.",
    p: ["#4A7C59", "#E0A458", "#F2E8CF", "#14261C"],
    s: "stars", r: "Western & global", a: "teachers day|teacher's day|teachers' day|teacher day|happy teachers day|world teachers day|shikshak diwas|shikshak divas" },
  { k: "teej", n: "Teej", g: "Happy Teej", e: "🌿",
    b: "Monsoon days of green bangles, mehendi and swings hung from trees, kept mostly by women together.",
    p: ["#1FA97C", "#E33E7E", "#F2C744", "#0A2E1E"],
    s: "leaves", r: "India & the subcontinent", a: "teej|hariyali teej|hartalika teej|haritalika teej|kajari teej|teej festival" },
  { k: "tet", n: "Tet", g: "Chuc Mung Nam Moi", e: "🌼",
    b: "Vietnamese Lunar New Year: apricot and peach blossoms, banh chung, family reunions and lucky money.",
    p: ["#C8102E", "#F2B705", "#FFD966", "#2E0509"],
    s: "petals", r: "East & Southeast Asia", a: "tet|tet nguyen dan|vietnamese new year|tet holiday|chuc mung nam moi|banh chung festival" },
  { k: "thanksgiving", n: "Thanksgiving", g: "Happy Thanksgiving", e: "🦃",
    b: "A harvest-time gathering for sharing food and naming the things you are grateful for.",
    p: ["#C1440E", "#7A4419", "#E3A72F", "#2A1206"],
    s: "leaves", r: "Western & global", a: "thanksgiving|thanks giving|thanksgiving day|turkey day|friendsgiving|action de grace" },
  { k: "ugadi", n: "Ugadi", g: "Ugadi Shubhakankshalu", e: "🍃",
    b: "New year for Telugu and Kannada homes, opened with a taste of six flavours for the year ahead.",
    p: ["#7CB518", "#F4C430", "#FFE066", "#0E2E1A"],
    s: "leaves", r: "India & the subcontinent", a: "ugadi|yugadi|ugadhi|ugadi festival|samvatsaradi|telugu new year|kannada new year" },
  { k: "uttarayan", n: "Uttarayan", g: "Kai Po Che!", e: "🪁",
    b: "Gujarat's rooftops fill from dawn to dusk with kites, cut strings and shouts of victory overhead.",
    p: ["#FF4D2E", "#FFD400", "#16C0F0", "#072A55"],
    s: "confetti", r: "India & the subcontinent", a: "uttarayan|uttarayana|kite festival|gujarati kite festival|international kite festival|patang|kai po che" },
  { k: "vaisakhi", n: "Vaisakhi", g: "Happy Vaisakhi", e: "🌾",
    b: "Punjab's harvest day and the founding of the Khalsa in 1699, kept with bhangra, dhol and langar.",
    p: ["#FF9500", "#E4B429", "#37B24D", "#12294F"],
    s: "leaves", r: "India & the subcontinent", a: "vaisakhi|baisakhi|vaishakhi|besakhi|baisaki|khalsa day|vaisakhi festival" },
  { k: "valentines-day", n: "Valentine's Day", g: "Happy Valentine's Day", e: "❤️",
    b: "A day for telling the people you love that you love them, in cards, flowers and small kindnesses.",
    p: ["#E0245E", "#FF8FA3", "#FFD166", "#3B061E"],
    s: "petals", r: "Western & global", a: "valentine|valentines|valentine's day|valentines day|valentine day|vday|v-day|happy valentines|saint valentines day" },
  { k: "vasant-panchami", n: "Vasant Panchami", g: "Shubh Vasant Panchami", e: "📖",
    b: "Spring's first day, dressed in yellow, when Saraswati is thanked for learning, music and words.",
    p: ["#FFD11A", "#F5A623", "#FFF6C2", "#0B2547"],
    s: "petals", r: "India & the subcontinent", a: "vasant panchami|basant panchami|vasant panchmi|basant panchmi|saraswati puja|sarasvati puja|shree panchami" },
  { k: "vesak", n: "Vesak", g: "Happy Vesak", e: "🪷",
    b: "Marks the Buddha's birth, enlightenment and passing with lanterns, almsgiving and quiet reflection.",
    p: ["#E9821E", "#1F5F63", "#FFF3C4", "#07231F"],
    s: "lanterns", r: "East & Southeast Asia", a: "vesak|wesak|vesak day|vesak poya|buddha purnima|buddha jayanti|buddha day|visakha bucha|saga dawa|buddha poornima|waisak|wesak day|vesakha" },
  { k: "vishu", n: "Vishu", g: "Vishu Ashamsakal", e: "🌼",
    b: "Kerala's new year, whose first sight is the vishukkani: golden konna blooms, rice, mirror and lamp.",
    p: ["#F5C518", "#E09B22", "#FFF0B3", "#2E1C06"],
    s: "sparks", r: "India & the subcontinent", a: "vishu|vishu festival|vishukkani|kerala new year|malayalam new year|vishu kani" },
  { k: "wedding", n: "Wedding", g: "Congratulations", e: "💒",
    b: "Two people choosing each other in front of everyone they love, and the celebration that follows.",
    p: ["#D4AF37", "#F3E9DC", "#E8B4B8", "#1C1430"],
    s: "petals", r: "Life events", a: "wedding|weding|marriage|married|just married|getting married|wedding day|shaadi|shadi|vivah|nikah|kalyanam" },
  { k: "womens-day", n: "International Women's Day", g: "Happy Women's Day", e: "💜",
    b: "A global day celebrating women's achievements and pressing on toward equality everywhere.",
    p: ["#6A2C91", "#2E9E5B", "#F2D06B", "#22083A"],
    s: "petals", r: "Western & global", a: "womens day|women's day|international womens day|international women's day|iwd|world womens day|8 march|march 8|mahila diwas" },
  { k: "yalda", n: "Yalda Night", g: "Shab-e Yalda Mubarak", e: "🍉",
    b: "The longest night of the year, spent with pomegranates, watermelon and Hafez poetry until light returns.",
    p: ["#A81E37", "#3B1F4E", "#F2A65A", "#1A0410"],
    s: "stars", r: "Persian & African", a: "yalda|yalda night|shab-e yalda|shab e yalda|shabe yalda|chelleh|shab-e chelleh|longest night" },
  { k: "yom-kippur", n: "Yom Kippur", g: "G'mar Chatima Tova", e: "📖",
    b: "The Day of Atonement: a solemn fast of prayer, repentance and reflection, holiest day of the Jewish year.",
    p: ["#DCDCE0", "#2A3A5C", "#A9B6CB", "#0A1224"],
    s: "stars", r: "Islamic & Jewish", a: "yom kippur|yom kipur|day of atonement|gmar chatima tova|g'mar chatima tova|kippur", x: 1 }
  ];

  /* The scene a festival gets when the name is not one we know. Not an error
     page: somebody typed a real festival that is simply not in the list —
     there are thousands — and the right answer is a warm greeting addressed
     to whatever they typed, not a shrug. The site's own accent colours, so an
     unrecognised festival still looks like it belongs here.

     WHAT IT MUST NOT DO is assume the day is a party. An unrecognised name is
     either a festival we are missing OR an observance we failed to recognise
     as somber, and there is no way from here to tell which. So the default is
     the one that is safe as both: no fabricated "Happy", no confetti, rising
     lanterns instead. A joyous day greeted a shade too gently costs nothing;
     a day of grief greeted with confetti is the failure this file exists to
     prevent. The greeting names the day the sender typed and wishes the
     recipient well, which is true either way. */
  var UNKNOWN = {
    k: '', n: '', g: '', e: '✨',
    b: 'Whatever this day means to you, may it be a good one.',
    p: ['#7dd3fc', '#f472b6', '#fde68a', '#10275c'],
    s: 'lanterns', a: ''
  };

  /* And the scene for a name that reads as mourning, atonement or
     remembrance but matches no entry — see SOLEMN_TOKENS below. Yom Kippur's
     muted palette and its still stars, a candle rather than a party popper,
     and a greeting that does not name the day at all: "Thinking of you
     today" is right whether the sender typed "funeral", "miscarriage" or
     "Lent", where any sentence built around the typed word would not be. The
     typed name goes in the eyebrow label instead, so the card still says what
     it is about. Carries x so the page withdraws its festoon lights. */
  var SOLEMN = {
    k: '', n: '', g: 'Thinking of you today', e: '🕯️',
    b: 'A day to keep quietly. However you are marking it, you are not marking it alone.',
    p: ['#DCDCE0', '#2A3A5C', '#A9B6CB', '#0A1224'],
    s: 'stars', a: '', x: 1
  };

  /* Strip to letters and digits before comparing. "Eid al-Fitr", "eid al
     fitr" and "EidAlFitr" are the same query; punctuation and spacing carry
     no information in a transliterated name. */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* Every normalised string that maps to a festival, built once. ~700 entries
     across 90 festivals, which is small enough that the linear scan in the
     fuzzy pass below is cheaper than any index would be. */
  var INDEX = [];
  for (var i = 0; i < DATA.length; i++) {
    var f = DATA[i];
    INDEX.push([norm(f.k), f]);
    INDEX.push([norm(f.n), f]);
    var al = f.a ? f.a.split('|') : [];
    for (var j = 0; j < al.length; j++) INDEX.push([norm(al[j]), f]);
  }

  /* Levenshtein, two rows rather than the full matrix. Called at most ~700
     times against strings under 30 characters, so this is microseconds — but
     only on the miss path, because exact matches never reach it. */
  function distance(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    /* An early bail on wildly different lengths: two strings whose lengths
       differ by more than the tolerance can never come in under it. */
    if (Math.abs(m - n) > 4) return 99;

    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;

    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
        );
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  /* Tolerance is a RATIO of the query's length, and capped. Scaling with
     length is the whole trick — at length 3 even a distance of 1 is a
     different festival, while a fifteen-letter transliteration can absorb a
     typo and still obviously be itself.

     But it has to be capped, and the cap is not a nicety either. The old
     ladder returned an absolute 3 for anything over ten characters, and
     "miscarriage" is eleven: distance("miscarriage", "marriage") is 3, so
     somebody typing the worst word of their year got Wedding and the word
     "Congratulations". Two edits is as far as this is allowed to reach.
     Beyond two, the strings are not a typo apart, they are different words —
     and being wrong here is not a broken link, it is a person hurt. */
  function tolerance(len) {
    return Math.min(Math.floor(len * 0.2), 2);
  }

  /* Words people wrap a festival name in. Dropped so that "happy diwali",
     "diwali festival" and "diwali wishes" all come down to the one token that
     carries meaning.

     "day" is deliberately NOT in here: it is load-bearing in "earth day",
     "mother's day" and "labour day". It is dropped only in the last pass
     below, after the pass that keeps it has already had its go. */
  var FILLER = {
    happy: 1, festival: 1, festivals: 1, wishes: 1, wish: 1,
    greetings: 1, greeting: 1, celebration: 1, celebrations: 1
  };

  /* Split the RAW query, BEFORE norm() gets to it. This ordering is the whole
     point: norm() strips the spaces, and the spaces are the only thing that
     tells the word "lent" from the four letters sitting inside "valentine".
     Any word-level work has to happen while the word boundaries still exist.

     Trailing digits belong to their token ("diwali2026" is one word, and the
     year is not part of the name); a token that is nothing but a four-digit
     year is dropped outright. */
  function tokenise(query) {
    var raw = String(query || '').toLowerCase().split(/[^a-z0-9]+/);
    var out = [], i, t;
    for (i = 0; i < raw.length; i++) {
      t = raw[i];
      if (!t) continue;
      if (/^\d{4}$/.test(t)) continue;
      t = t.replace(/\d+$/, '');
      if (t) out.push(t);
    }
    return out;
  }

  function exact(s) {
    if (!s) return null;
    for (var k = 0; k < INDEX.length; k++) {
      if (INDEX[k][0] === s) return INDEX[k][1];
    }
    return null;
  }

  /* Nearest index entry within tolerance, or null. Only reached on a miss. */
  function nearest(s) {
    var tol = tolerance(s.length);
    if (!tol) return null;

    var best = null, bestD = 99;
    for (var k = 0; k < INDEX.length; k++) {
      var d = distance(s, INDEX[k][0]);
      if (d < bestD) { bestD = d; best = INDEX[k][1]; if (!d) break; }
    }
    return bestD <= tol ? best : null;
  }

  /* Returns a festival, or null. Never throws — a bad query is a miss. */
  function resolve(query) {
    var q = norm(query);
    if (!q) return null;

    /* The whole query, exactly. Nearly every real hit lands here. */
    var hit = exact(q);
    if (hit) return hit;

    /* THEN THE SAME THING, MINUS THE PACKAGING. This pass exists for "happy
       diwali", "diwali festival" and "diwali2026", and for nothing else.

       It used to be unanchored substring containment, and that was a bug with
       teeth: norm() had already destroyed the word boundaries, so "lent" —
       a Christian fast — was found inside "valentine" and ?name=Lent returned
       Valentine's Day. "puja" landed inside "govardhanpuja" and "birthday"
       inside "gurunanakbirthday". Substring matching cannot tell a word from
       a coincidence of letters, so it is gone. Whole tokens only, and each
       one still has to be an EXACT index entry to count. */
    /* `=== 1`, not truthiness: these are plain object literals, so a query
       token of "constructor" or "toString" finds something inherited from
       Object.prototype and would otherwise read as a hit. */
    var t = tokenise(query), kept = [], i;
    for (i = 0; i < t.length; i++) if (FILLER[t[i]] !== 1) kept.push(t[i]);

    var joined = kept.join('');
    if (joined && joined !== q) {
      hit = exact(joined);
      if (hit) return hit;
    }

    /* Last, each remaining token on its own — "diwali" out of "diwali 2026
       wishes". "day" is dropped here and only here, so "happy earth day" has
       already been tried whole (and matched) by the pass above. Three
       characters minimum: "eid" is a real alias, anything shorter is not. */
    for (i = 0; i < kept.length; i++) {
      if (kept[i].length < 3 || kept[i] === 'day') continue;
      hit = exact(kept[i]);
      if (hit) return hit;
    }

    /* Only now the edit distance, on the query and — if the packaging came
       off — on what was left of it, so "happy diwaali" gets the same second
       chance a bare "diwaali" would. */
    hit = nearest(q);
    if (hit) return hit;
    if (joined && joined !== q) return nearest(joined);
    return null;
  }

  /* WORDS THAT MEAN THE DAY IS NOT A PARTY. Matched as whole tokens of the
     raw query, never as substrings — "lent" is a fast, but it is also four
     letters sitting inside "valentine", and substring matching here would
     turn Valentine's Day into a day of mourning, which is the resolver's old
     bug pointed the other way.

     This list is a floor, not a census. It cannot enumerate every somber
     observance in the world, which is exactly why the neutral fallback above
     had to be made safe as well — this catches the ones we can name, and
     UNKNOWN catches the rest without assuming joy. */
  var SOLEMN_TOKENS = {
    mourning: 1, mourn: 1, mourners: 1, memorial: 1, memoriam: 1,
    remembrance: 1, funeral: 1, funerals: 1, condolence: 1, condolences: 1,
    death: 1, died: 1, dead: 1, deceased: 1, passing: 1, loss: 1,
    bereavement: 1, bereaved: 1, miscarriage: 1, stillbirth: 1,
    lent: 1, ashura: 1, requiem: 1, martyr: 1, martyrs: 1, martyrdom: 1,
    genocide: 1, holocaust: 1, shoah: 1, tragedy: 1, vigil: 1, rip: 1
  };

  /* Phrases whose words are innocent apart and somber together. Long enough
     once normalised that a substring test cannot land inside anything else. */
  var SOLEMN_PHRASES = [
    'anniversaryofdeath', 'deathanniversary', 'goodfriday', 'ashwednesday',
    'restinpeace', 'inmemoriam', 'inmemoryof', 'inlovingmemory',
    'dayofmourning', 'yahrzeit'
  ];

  function isSomber(query) {
    var t = tokenise(query), i;
    /* `=== 1` for the same Object.prototype reason as in resolve(). */
    for (i = 0; i < t.length; i++) if (SOLEMN_TOKENS[t[i]] === 1) return true;

    var q = norm(query);
    /* "R.I.P." tokenises to r/i/p, so catch it once the dots are gone. */
    if (q === 'rip') return true;
    for (i = 0; i < SOLEMN_PHRASES.length; i++) {
      if (q.indexOf(SOLEMN_PHRASES[i]) !== -1) return true;
    }
    return false;
  }

  /* Shape a festival — or one of the two fallbacks dressed in the typed name —
     into what celebrate.js's mount() expects. Kept here rather than in
     festival.js so the generator's preview and the real page cannot disagree
     about what a festival looks like. */
  function scene(query) {
    var f = resolve(query);
    var known = !!f;

    /* THE SOLEMN GUARD, ahead of anything that would greet anybody. Two ways
       to get here, and both used to end in confetti:

       ?name=funeral matched nothing and fell through to a generic
       celebration, which prefixed "Happy" to whatever was typed.

       ?name=death%20anniversary DID match — on the token "anniversary" — and
       came back "Happy Anniversary" over a wedding palette.

       So the guard overrides a resolved festival too, unless that festival is
       already marked solemn: ?name=ashura is Muharram, and Muharram's own
       muted palette and "A Month of Remembrance" say more than anything
       generic could. Leave the ones the table already handles alone. */
    var somber = isSomber(query);
    if (somber && !(known && f.x)) { known = false; f = SOLEMN; }
    else if (!known) f = UNKNOWN;

    /* An unknown festival is named by the name the sender typed. Title-cased
       only where they typed it all lower — somebody who wrote "MahaShivratri"
       or "Eid" meant that, and re-casing it would be presumptuous. */
    var display = known ? f.n : titleIfFlat(query);

    var greeting;
    if (known) greeting = f.g;
    else if (somber) greeting = SOLEMN.g;
    /* Not "Happy " + display. See UNKNOWN: the day might be a festival we are
       missing or a grief we failed to name, and "wishing you well" is the one
       phrasing that is true of both. The nameless branch is unreachable from
       /festival — celebrate-guard.js redirects a visitor with no usable
       ?name= before this runs — but scene() is also the generator's live
       preview, and "Wishing you well on " with nothing after it is not a
       sentence to render even for a keystroke. */
    else greeting = display ? 'Wishing you well on ' + display : 'Wishing you well';

    /* THE FESTIVAL'S NAME, WHEN THE GREETING DOES NOT ALREADY SAY IT.
       "Happy Diwali" needs no label. "G'mar Chatima Tova" does — and so do
       "Saal Mubarak", "Kai Po Che!", "Onashamsakal" and 35 others, where the
       authentic greeting is a phrase that never mentions the festival. Without
       this the recipient gets words they may not recognise and no way to tell
       what is being wished; the site owner hit exactly that on Yom Kippur.
       Using the authentic greeting is right, but it has to be legible. */
    var label = '';
    if (known) {
      var g = norm(f.g), n = norm(f.n);
      if (g.indexOf(n) === -1 && n.indexOf(g) === -1) label = f.n;
    } else if (somber) {
      /* The quiet greeting never names the day, so the eyebrow has to. */
      label = display;
    }

    return {
      /* `known` is what the two callers use to decide how confident to be, and
         on the quiet path we ARE confident — confident it must stay quiet. So
         it reports true there even though nothing matched the table.
         festival.js appends "!" to the document and share title when known is
         false, and "Thinking of you today!" is precisely the wrong sentence;
         the generator, likewise, would offer "a general festive look". Both
         read correctly with true. The unrecognised-but-not-somber path keeps
         false, because there the generator's "not one I know" warning is the
         honest thing to show the sender before they send it. */
      known: known || somber,
      key: f.k,
      label: label,
      /* Days of mourning, atonement and remembrance. festival.js passes this
         through to the page, which withdraws the festoon lights and stills
         the motif. A greeting page has to be able to be quiet: lighting up
         Yom Kippur or Ashura with party bunting would be worse than having
         no page for them at all. */
      solemn: !!f.x,
      name: display,
      greeting: greeting,
      glyph: f.e,
      blurb: f.b,
      particles: f.s,
      palette: { primary: f.p[0], secondary: f.p[1], accent: f.p[2], glow: f.p[3] },
      /* Particle colours: the three bright palette entries plus white, which
         keeps a two-colour festival from looking like a repeating pattern. */
      colors: [f.p[0], f.p[1], f.p[2], f.p[0], f.p[2], '#ffffff']
    };
  }

  function titleIfFlat(s) {
    s = String(s || '').trim();
    if (s !== s.toLowerCase()) return s;
    return s.replace(/(^|\s)([a-z])/g, function (m, sp, ch) { return sp + ch.toUpperCase(); });
  }

  /* Every festival, bucketed by region and each bucket sorted by name — the
     shape the generator's dropdown needs. Built here rather than there so the
     region strings live in exactly one place. Returns an array of
     { region, items } so the caller keeps the deliberate region ORDER (the
     site owner's own festivals first) instead of an object's key order. */
  /* Explicit, because DATA is sorted by key and taking the order from
     first-appearance put "Life events" at the top on the strength of
     "anniversary" beginning with an A. This site is written by an Indian
     engineer for an audience that is largely Indian; those festivals lead,
     and the life events — which are not festivals at all — come last. */
  var REGION_ORDER = [
    'India & the subcontinent',
    'Islamic & Jewish',
    'East & Southeast Asia',
    'Persian & African',
    'Western & global',
    'Life events'
  ];

  function grouped() {
    var order = [], buckets = {}, i;
    for (i = 0; i < DATA.length; i++) {
      var r = DATA[i].r || 'Other';
      if (!buckets[r]) { buckets[r] = []; order.push(r); }
      buckets[r].push(DATA[i]);
    }
    /* Known regions in the order above; anything a future entry invents keeps
       its first-appearance position at the end rather than vanishing. */
    order.sort(function (a, b) {
      var ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return order.map(function (r) {
      return {
        region: r,
        items: buckets[r].slice().sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; })
      };
    });
  }

  window.KSFestivals = {
    all: DATA,
    resolve: resolve,
    scene: scene,
    grouped: grouped
  };
})();
