/**
 * Offline English → Vietnamese dictionary for the bulk vocabulary editor.
 * No AI, no network: common words a learner types when building a word set.
 * Unknown words are reported back instead of guessed.
 * One meaning per word (the most common one) — ambiguous words belong in
 * the editor with an explicit "word:nghĩa" form.
 */

const WORDS: Record<string, string> = {
  // Greetings & basics
  "hello": "xin chào", "hi": "chào", "goodbye": "tạm biệt", "bye": "tạm biệt",
  "good morning": "chào buổi sáng", "good afternoon": "chào buổi chiều", "good evening": "chào buổi tối",
  "good night": "chúc ngủ ngon", "please": "làm ơn", "thank": "cảm ơn", "thanks": "cảm ơn",
  "sorry": "xin lỗi", "yes": "vâng", "no": "không", "ok": "được", "welcome": "chào mừng",
  "name": "tên", "friend": "bạn bè", "love": "yêu", "family": "gia đình",

  // Numbers
  "one": "một", "two": "hai", "three": "ba", "four": "bốn", "five": "năm",
  "six": "sáu", "seven": "bảy", "eight": "tám", "nine": "chín", "ten": "mười",
  "eleven": "mười một", "twelve": "mười hai", "twenty": "hai mươi", "hundred": "trăm",
  "thousand": "nghìn", "million": "triệu", "zero": "số không",

  // People & family
  "mother": "mẹ", "mom": "mẹ", "father": "cha", "dad": "bố", "parent": "cha mẹ",
  "son": "con trai", "daughter": "con gái", "brother": "anh/em trai", "sister": "chị/em gái",
  "grandmother": "bà", "grandfather": "ông", "child": "đứa trẻ", "children": "trẻ em",
  "baby": "em bé", "man": "đàn ông", "woman": "phụ nữ", "boy": "con trai", "girl": "con gái",
  "people": "mọi người", "person": "người", "husband": "chồng", "wife": "vợ",
  "teacher": "giáo viên", "student": "học sinh", "doctor": "bác sĩ", "nurse": "y tá",
  "engineer": "kỹ sư", "farmer": "nông dân", "worker": "công nhân", "driver": "tài xế",
  "singer": "ca sĩ", "artist": "nghệ sĩ", "writer": "nhà văn", "chef": "đầu bếp",
  "police": "cảnh sát", "dentist": "nha sĩ", "pilot": "phi công", "actor": "diễn viên",

  // Body
  "head": "đầu", "hair": "tóc", "face": "khuôn mặt", "eye": "mắt", "ear": "tai",
  "nose": "mũi", "mouth": "miệng", "tooth": "răng", "tongue": "lưỡi", "neck": "cổ",
  "shoulder": "vai", "arm": "cánh tay", "hand": "bàn tay", "finger": "ngón tay",
  "leg": "chân", "foot": "bàn chân", "knee": "đầu gối", "back": "lưng",
  "stomach": "bụng", "heart": "trái tim", "blood": "máu", "skin": "da",
  "bone": "xương", "brain": "não", "body": "cơ thể",

  // Food & drink
  "food": "thức ăn", "rice": "cơm", "bread": "bánh mì", "noodles": "mì",
  "meat": "thịt", "beef": "thịt bò", "pork": "thịt lợn", "chicken": "thịt gà", "fish": "cá",
  "egg": "trứng", "milk": "sữa", "cheese": "phô mai", "butter": "bơ",
  "sugar": "đường", "salt": "muối", "pepper": "tiêu", "oil": "dầu", "water": "nước",
  "tea": "trà", "coffee": "cà phê", "juice": "nước ép", "fruit": "trái cây",
  "apple": "quả táo", "banana": "quả chuối", "orange": "quả cam", "grape": "quả nho",
  "mango": "quả xoài", "lemon": "quả chanh", "pineapple": "quả dứa", "watermelon": "quả dưa hấu",
  "strawberry": "quả dâu tây", "vegetable": "rau", "cabbage": "bắp cải", "tomato": "cà chua",
  "potato": "khoai tây", "carrot": "cà rốt", "onion": "hành tây", "garlic": "tỏi",
  "corn": "ngô", "cake": "bánh ngọt", "candy": "kẹo", "ice cream": "kem",
  "chocolate": "sô-cô-la", "soup": "súp", "breakfast": "bữa sáng", "lunch": "bữa trưa",
  "dinner": "bữa tối", "snack": "đồ ăn nhẹ", "hungry": "đói", "thirsty": "khát",
  "sweet": "ngọt", "sour": "chua", "bitter": "đắng", "spicy": "cay", "delicious": "ngon",

  // Animals
  "animal": "động vật", "dog": "chó", "cat": "mèo", "bird": "chim", "horse": "ngựa",
  "cow": "bò", "pig": "lợn", "sheep": "cừu", "goat": "dê", "duck": "vịt",
  "elephant": "voi", "tiger": "hổ", "lion": "sư tử", "monkey": "khỉ", "snake": "rắn",
  "mouse": "chuột", "rabbit": "thỏ", "bear": "gấu", "wolf": "sói", "frog": "ếch",
  "insect": "côn trùng", "butterfly": "bướm", "bee": "con ong", "ant": "con kiến",
  "spider": "nhện", "shark": "cá mập", "whale": "cá voi", "turtle": "rùa", "dragon": "rồng",

  // Colors
  "color": "màu", "red": "màu đỏ", "blue": "màu xanh dương", "green": "màu xanh lá",
  "yellow": "màu vàng", "black": "màu đen", "white": "màu trắng", "purple": "màu tím",
  "pink": "màu hồng", "brown": "màu nâu", "gray": "màu xám",

  // Time
  "time": "thời gian", "day": "ngày", "night": "đêm", "morning": "buổi sáng",
  "afternoon": "buổi chiều", "evening": "buổi tối", "today": "hôm nay",
  "tomorrow": "ngày mai", "yesterday": "hôm qua", "now": "bây giờ", "later": "sau này",
  "week": "tuần", "month": "tháng", "year": "năm", "hour": "giờ",
  "minute": "phút", "monday": "thứ hai", "tuesday": "thứ ba",
  "wednesday": "thứ tư", "thursday": "thứ năm", "friday": "thứ sáu",
  "saturday": "thứ bảy", "sunday": "chủ nhật", "weekend": "cuối tuần",
  "birthday": "sinh nhật", "holiday": "ngày lễ", "clock": "đồng hồ", "early": "sớm", "late": "muộn",

  // Weather & nature
  "weather": "thời tiết", "sun": "mặt trời", "moon": "mặt trăng", "star": "ngôi sao",
  "sky": "bầu trời", "cloud": "mây", "rain": "mưa", "wind": "gió", "snow": "tuyết",
  "storm": "bão", "hot": "nóng", "cold": "lạnh", "warm": "ấm", "cool": "mát",
  "sea": "biển", "ocean": "đại dương", "river": "sông", "lake": "hồ",
  "mountain": "núi", "hill": "đồi", "forest": "rừng", "tree": "cây",
  "flower": "hoa", "leaf": "lá", "grass": "cỏ", "earth": "trái đất",
  "fire": "lửa", "air": "không khí", "sand": "cát", "stone": "đá", "gold": "vàng",
  "light": "ánh sáng", "dark": "tối",

  // Places & things
  "house": "ngôi nhà", "home": "nhà", "room": "phòng", "bedroom": "phòng ngủ",
  "kitchen": "nhà bếp", "bathroom": "phòng tắm", "door": "cửa", "window": "cửa sổ",
  "school": "trường học", "class": "lớp học", "classroom": "phòng học",
  "library": "thư viện", "hospital": "bệnh viện", "market": "chợ",
  "shop": "cửa hàng", "store": "cửa hàng", "restaurant": "nhà hàng", "hotel": "khách sạn",
  "bank": "ngân hàng", "park": "công viên", "city": "thành phố",
  "town": "thị trấn", "village": "làng", "country": "quốc gia", "street": "đường phố",
  "road": "con đường", "bridge": "cây cầu", "airport": "sân bay", "station": "nhà ga",
  "farm": "nông trại", "office": "văn phòng", "factory": "nhà máy", "church": "nhà thờ",
  "beach": "bãi biển", "island": "hòn đảo", "world": "thế giới", "garden": "vườn",
  "wall": "bức tường", "floor": "sàn nhà", "table": "cái bàn", "chair": "cái ghế",
  "bed": "giường", "box": "hộp", "cup": "cốc", "glass": "ly", "bottle": "chai",
  "phone": "điện thoại", "computer": "máy tính", "television": "tivi", "radio": "ra-đi-ô",
  "book": "quyển sách", "pen": "bút", "pencil": "bút chì", "paper": "giấy",
  "bag": "túi", "key": "chìa khóa", "money": "tiền",
  "umbrella": "cây dù", "mirror": "gương", "camera": "máy ảnh", "glasses": "cái kính",
  "shoe": "đôi giày", "shirt": "cái áo", "hat": "cái mũ", "dress": "váy",
  "coat": "áo khoác", "pants": "quần",

  // School & study
  "study": "học tập", "read": "đọc", "write": "viết", "draw": "vẽ",
  "count": "đếm", "test": "bài kiểm tra", "exam": "kỳ thi", "homework": "bài tập về nhà",
  "lesson": "bài học", "question": "câu hỏi", "answer": "câu trả lời",
  "subject": "môn học", "math": "toán", "history": "lịch sử", "geography": "địa lý",
  "science": "khoa học", "physics": "vật lý", "chemistry": "hóa học", "biology": "sinh học",
  "literature": "văn học", "english": "tiếng Anh", "music": "âm nhạc", "art": "nghệ thuật",
  "sport": "thể thao", "word": "từ", "sentence": "câu", "language": "ngôn ngữ",
  "letter": "chữ cái", "number": "con số", "picture": "bức tranh", "map": "bản đồ", "board": "cái bảng",

  // Common verbs
  "go": "đi", "come": "đến", "walk": "đi bộ", "run": "chạy", "jump": "nhảy",
  "swim": "bơi", "fly": "bay", "sit": "ngồi", "stand": "đứng", "sleep": "ngủ",
  "eat": "ăn", "drink": "uống", "cook": "nấu ăn", "play": "chơi", "work": "làm việc",
  "help": "giúp đỡ", "give": "cho", "take": "lấy", "bring": "mang", "buy": "mua",
  "sell": "bán", "pay": "trả tiền", "open": "mở", "close": "đóng", "start": "bắt đầu",
  "finish": "kết thúc", "stop": "dừng lại", "wait": "chờ đợi", "look": "nhìn",
  "see": "thấy", "listen": "lắng nghe", "hear": "nghe", "speak": "nói",
  "say": "nói", "tell": "kể", "ask": "hỏi", "think": "suy nghĩ", "know": "biết",
  "understand": "hiểu", "remember": "nhớ", "forget": "quên", "teach": "dạy",
  "find": "tìm thấy", "lose": "mất", "make": "làm", "build": "xây dựng", "cut": "cắt",
  "wash": "rửa", "clean": "lau dọn", "move": "di chuyển", "carry": "mang vác",
  "hold": "cầm", "put": "đặt", "choose": "lựa chọn", "try": "thử", "use": "sử dụng",
  "need": "cần", "want": "muốn", "like": "thích", "hope": "hy vọng", "wish": "ước",
  "feel": "cảm thấy", "laugh": "cười", "cry": "khóc", "smile": "mỉm cười",
  "sing": "hát", "dance": "nhảy múa", "travel": "du lịch", "visit": "thăm",
  "meet": "gặp gỡ", "call": "gọi", "send": "gửi", "grow": "trồng",
  "change": "thay đổi", "happen": "xảy ra", "become": "trở thành", "believe": "tin",
  "decide": "quyết định", "learn": "học", "watch": "xem",

  // Common adjectives
  "good": "tốt", "bad": "xấu", "big": "to", "small": "nhỏ", "long": "dài",
  "short": "ngắn", "tall": "cao", "new": "mới", "old": "cũ", "young": "trẻ",
  "beautiful": "đẹp", "pretty": "xinh", "ugly": "xấu xí", "fast": "nhanh", "slow": "chậm",
  "happy": "vui vẻ", "sad": "buồn", "angry": "tức giận", "afraid": "sợ",
  "tired": "mệt", "sick": "ốm", "strong": "mạnh", "weak": "yếu",
  "easy": "dễ", "difficult": "khó", "important": "quan trọng", "interesting": "thú vị",
  "boring": "nhàm chán", "funny": "vui nhộn", "right": "đúng", "wrong": "sai",
  "true": "thật", "full": "đầy", "empty": "rỗng", "heavy": "nặng",
  "rich": "giàu", "poor": "nghèo", "cheap": "rẻ", "expensive": "đắt tiền",
  "safe": "an toàn", "dangerous": "nguy hiểm", "quiet": "yên tĩnh", "loud": "ồn ào",
  "dirty": "bẩn", "fresh": "tươi mới", "dry": "khô", "wet": "ướt",
  "busy": "bận", "free": "rảnh", "ready": "sẵn sàng", "careful": "cẩn thận",
  "kind": "tốt bụng", "smart": "thông minh", "clever": "lanh lợi",
  "lazy": "lười biếng", "polite": "lịch sự", "shy": "nhút nhát", "brave": "dũng cảm",

  // Common nouns & others
  "thing": "vật", "something": "vài thứ", "nothing": "không có gì",
  "everyone": "mọi người", "everything": "mọi thứ", "place": "nơi chốn",
  "way": "cách", "problem": "vấn đề", "reason": "lý do", "example": "ví dụ",
  "idea": "ý tưởng", "dream": "giấc mơ", "job": "công việc", "game": "trò chơi",
  "team": "đội", "match": "trận đấu", "winner": "người thắng", "gift": "món quà",
  "story": "câu chuyện", "news": "tin tức", "truth": "sự thật", "life": "cuộc sống",
  "health": "sức khỏe", "luck": "may mắn", "fun": "niềm vui", "rest": "nghỉ ngơi",
  "song": "bài hát", "movie": "bộ phim", "photo": "bức ảnh",
  "car": "xe hơi", "bus": "xe buýt", "train": "tàu hỏa", "bike": "xe đạp",
  "plane": "máy bay", "boat": "thuyền", "ship": "tàu thủy", "ticket": "vé",
  "trip": "chuyến đi", "message": "tin nhắn", "website": "trang web",
  "internet": "mạng internet", "email": "thư điện tử", "password": "mật khẩu",
  "file": "tệp", "tool": "công cụ", "machine": "cỗ máy",
};

/** Look up one English word (case-insensitive). Returns undefined when unknown. */
export function translateEnToVi(word: string): string | undefined {
  return WORDS[word.trim().toLowerCase()];
}

export type BulkEntry = { english: string; vietnamese: string };

/**
 * Parse the bulk editor input into entries, auto-translating bare English
 * words via the offline dictionary.
 *
 * Accepted forms (mixable, separated by newline or `;`):
 *   happy                        → auto-translate
 *   happy,hello                  → both auto-translated
 *   happy:vui vẻ                 → kept as-is
 *   happy:vui vẻ,hello:xin chào  → two pairs (comma splits only when EVERY
 *                                  comma segment contains a colon, so a
 *                                  meaning like "quản lý, người quản lý"
 *                                  with a comma survives intact)
 *
 * Words not found in the dictionary come back in `unknown` — the caller
 * reports them instead of guessing a meaning.
 */
export function expandBulkInput(raw: string): { entries: BulkEntry[]; unknown: string[] } {
  const entries: BulkEntry[] = [];
  const unknown: string[] = [];
  for (const row of raw.replace(/\r/g, "\n").split(/[;\n]+/)) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.search(/[:：]/);
    if (colonIndex > 0) {
      const segments = trimmed.split(",");
      const allPairs = segments.length > 1 && segments.every(s => /[:：]/.test(s));
      for (const segment of allPairs ? segments : [trimmed]) {
        const english = segment.slice(0, segment.search(/[:：]/)).trim();
        const vietnamese = segment.slice(segment.search(/[:：]/) + 1).trim();
        if (english && vietnamese) entries.push({ english, vietnamese });
      }
    } else {
      for (const word of trimmed.split(",")) {
        const clean = word.trim();
        if (!clean) continue;
        const vietnamese = translateEnToVi(clean);
        if (vietnamese === undefined) unknown.push(clean);
        else entries.push({ english: clean, vietnamese });
      }
    }
  }
  return { entries, unknown };
}

/**
 * Rewrite bulk input in place: every bare word becomes "word:nghĩa" when the
 * dictionary knows it. Unknown words stay as bare lines so the user can fill
 * them in manually — nothing is dropped.
 */
export function autoTranslateText(raw: string): { text: string; unknown: string[] } {
  const { entries, unknown } = expandBulkInput(raw);
  if (!entries.length && !unknown.length) return { text: raw, unknown: [] };
  const lines = entries.map(e => `${e.english}:${e.vietnamese}`);
  if (unknown.length) lines.push(...unknown);
  return { text: lines.join("\n"), unknown };
}
