/* ==========================================================================
   proof-band.js — nine recommendations under the hero, a different nine on
   every load.
   --------------------------------------------------------------------------
   index.html ships NINE cards, not thirty. That is deliberate: nine is the
   grid, and a visitor with JavaScript off — or a crawler — still gets nine
   real, named, attributable quotes rather than an empty section. The other
   twenty-one live here as data, so the page stays small while the band still
   changes between visits.

   POOL is generated from client-reviews.html, which remains the source of
   truth for all thirty. If a quote is edited there, regenerate this list.

   Math.random() rather than the clock. The recommendations page derives its
   featured pick from Date.now() so nothing has to be stored, which is right
   for one rotating card — but nine cards drawn off the same second would move
   together, and two loads inside the same second would be identical. Drawing
   nine of thirty gives about 14 million combinations.

   Text is written with textContent, never innerHTML: these are real people's
   words and must never be parsed as markup.
   ========================================================================== */

(function () {
  'use strict';

  var POOL = [
    { q: 'Being mentored by Krunalkumar was an incredible experience; his insights and encouragement greatly shaped my learning and career direction.',
      n: 'Md Intekhab Alam', r: 'Software Engineer · Frontend Developer · ReactJS' },
    { q: 'Krunal is an exceptional developer but an even greater human with a positive, can-do attitude. He always sees the good in every situation and has an uncanny ability to find more efficient ways to get the job done.',
      n: 'Brandon Dith-Berry', r: 'RevOps Leader · AI Strategy & Enablement' },
    { q: 'I had the pleasure of being mentored by Krunal Kumar Shah during my Advanced React mock interview. His guidance was exceptional and his feedback provided a fresh perspective on React that will be immensely helpful for my future growth.',
      n: 'Vijay Pratap Singh Jadon', r: 'Full Stack Developer · MERN Stack' },
    { q: 'Krunalkumar is a valuable contributor to our initiative. He brings not only his expertise in cybersecurity, but also a vibrant, positive attitude that energizes the team.',
      n: 'Alice Pavaloiu', r: 'Co-founder at Open Ethics & English Right' },
    { q: 'I highly recommend Krunalkumar for his exceptional expertise in software engineering, AI, and cybersecurity. His approach was amazing—thoughtful, insightful, and highly engaging.',
      n: 'Anish Patel', r: 'Java Developer at Mphasis' },
    { q: 'Krunal\'s expertise, dedication, and exceptional teaching skills were instrumental in shaping my understanding and approach to programming.',
      n: 'Vivek Dubey', r: 'Software Engineer II @ Ionage' },
    { q: 'A brilliant mind who combines genius with remarkable simplicity, making complex concepts accessible and engaging.',
      n: 'Nonye Nwogu', r: 'Linux · AWS · Nutanix · VMware · DevOps' },
    { q: 'A very engaged, knowledgeable professional who provided excellent support as a teaching assistant.',
      n: 'Dr. Mary Dunphy', r: 'CISSP, CISA, PMP, SABSA SCP, PCI-QSA, GCP-PCA' },
    { q: 'A highly skilled cybersecurity expert whose dedication and expertise have significantly contributed to the success of our initiatives.',
      n: 'Reginald Osuji', r: 'Cybersecurity Trainer · Penetration Tester' },
    { q: 'A dedicated and highly skilled professional with deep understanding and effective communication skills.',
      n: 'Ilham Laabab', r: 'Researcher' },
    { q: 'A unique ability to ensure students grasp complex concepts in detail and guide them toward the best possible outcomes.',
      n: 'Cecilia Vargas', r: 'Software Engineer · CSS · Python · JavaScript' },
    { q: 'A great mentor who helped make the program easier and guided me on how to succeed in this field.',
      n: 'Omar Millan', r: 'Aspiring Cybersecurity Professional' },
    { q: 'Passionate, caring, and knowledgeable, with a talent for breaking down complicated code into understandable concepts.',
      n: 'Roberto Del Rosario', r: 'Full Stack AI Software Developer' },
    { q: 'A positive attitude and collaborative spirit that made him an exceptional team player.',
      n: 'Shilpa Tirumuru', r: 'Senior Test Engineer' },
    { q: 'A confident communicator who brings creativity, warmth, and strong interpersonal skills to every interaction.',
      n: 'Aakanksha Vora', r: 'HR Professional' },
    { q: 'A unique blend of academic strength, mentorship, clear judgment, and dynamic personality.',
      n: 'Akash Kumar', r: 'Software Developer' },
    { q: 'A mentor who is available, knowledgeable, and great at helping others work through challenges.',
      n: 'Camryn Scott', r: 'Cloud Engineer' },
    { q: 'A strong technical background paired with a genuine passion for sharing knowledge and helping others grow.',
      n: 'Carlos Montoya', r: 'Learning Designer' },
    { q: 'An extremely intelligent, articulate, diligent, and dedicated coach and mentor.',
      n: 'Tina Alfred, PhD, MPH', r: 'Epidemiologist · Medical Research Writer' },
    { q: 'A great mentor and advisor with clear thinking and the ability to simplify complex technical problems.',
      n: 'Noriel Tunon', r: 'Senior Helpdesk Specialist' },
    { q: 'Highly driven, motivated, and always willing to help people solve problems and grow.',
      n: 'Yankam Brenda, PhD', r: 'Statistician · Epidemiologist' },
    { q: 'An outstanding communicator who helped students stay on track and taught with genuine care.',
      n: 'Nick Rothacher', r: 'Director of Student Success' },
    { q: 'Smart, kind, and deeply supportive, with a strong background and a generous mentoring spirit.',
      n: 'Katherine Zuluaga', r: 'Operations Management Expert' },
    { q: 'A great technical resource for programming and testing questions, always enjoyable to work with.',
      n: 'Shuaib Gill', r: 'Senior QA Lead · AWS Certified Architect' },
    { q: 'An expert in his field with strong professional credibility and knowledge.',
      n: 'Kabir Mohammed Tukur', r: 'IT Leader · Consultant · Trainer' },
    { q: 'A kind mentor whose work in data science inspired and helped others achieve their goals.',
      n: 'Puroshotam Singh', r: 'AI Engineering @ Crowe' },
    { q: 'A well-qualified senior engineer with solid cybersecurity expertise and excellent soft skills.',
      n: 'Geovani dos Santos', r: 'Consulting · AI · Data Science · Cybersecurity' },
    { q: 'A great interaction and a trusted resource for IT security and cybersecurity guidance.',
      n: 'Michael Horgle', r: 'Security Analyst · IT Support Specialist' },
    { q: 'A hardworking, dedicated, and highly intelligent professional with tremendous potential.',
      n: 'Joseph Ede', r: 'Executive · Finance & Strategy' },
    { q: 'An excellent professional who enjoys sharing technical knowledge and contributing to the IT community.',
      n: 'Eduardo Dias', r: 'Technical Project Manager' }
  ];

  var band = document.getElementById('proof-band');
  if (!band) return;

  var cards = Array.prototype.slice.call(band.querySelectorAll('.proof-card'));
  if (!cards.length || POOL.length <= cards.length) return;

  /* Fisher-Yates. The naive sort(function () { return Math.random() - 0.5; })
     is not a uniform shuffle — it visibly favours the original order in V8 —
     and here that would mean the same few quotes surfacing far more often than
     the rest, which is the one thing this is meant to avoid. */
  var order = POOL.map(function (_, i) { return i; });
  for (var i = order.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = order[i]; order[i] = order[j]; order[j] = t;
  }

  for (var k = 0; k < cards.length; k++) {
    var pick = POOL[order[k]];
    var quote = cards[k].querySelector('blockquote');
    var name = cards[k].querySelector('.proof-name');
    var role = cards[k].querySelector('.proof-role');
    if (quote) quote.textContent = pick.q;
    if (name) name.textContent = pick.n;
    if (role) role.textContent = pick.r;
  }
}());
