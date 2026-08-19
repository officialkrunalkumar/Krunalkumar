/* ==========================================================================
   buddha.js — the three moving parts of /buddha.
   --------------------------------------------------------------------------
   1. a verse, different on every load
   2. the breathing label, in step with the ring
   3. the leaves and the motes of light

   Every quote below is from the Pali Canon with its citation attached. That
   constraint is doing real work: most "Buddha quotes" in circulation were
   never said by the Buddha — "holding on to anger is like grasping a hot
   coal", "what you think, you become", "peace comes from within" are all
   modern inventions. A page that asks someone to sit quietly with a sentence
   should be honest about where the sentence came from. If you add to this
   list, add the citation with it, and check it against suttacentral.net or
   accesstoinsight.org first.
   ========================================================================== */

(function () {
  'use strict';

  var QUOTES = [
    { text: 'Hatred is never appeased by hatred in this world. By non-hatred alone is hatred appeased.',
      cite: 'Dhammapada 5' },
    { text: 'If with a pure mind a person speaks or acts, happiness follows like a never-departing shadow.',
      cite: 'Dhammapada 2' },
    { text: 'Neither mother, father, nor any other relative can do one greater good than one’s own well-directed mind.',
      cite: 'Dhammapada 43' },
    { text: 'Just as a solid rock is not shaken by the storm, even so the wise are not affected by praise or blame.',
      cite: 'Dhammapada 81' },
    { text: 'Better than a thousand useless words is one useful word, hearing which one attains peace.',
      cite: 'Dhammapada 100' },
    { text: 'Victory begets enmity; the defeated dwell in pain. Happily the peaceful live, discarding both victory and defeat.',
      cite: 'Dhammapada 201' },
    { text: 'Health is the most precious gain and contentment the greatest wealth.',
      cite: 'Dhammapada 204' },
    { text: 'Overcome the angry by non-anger; the wicked by goodness; the miser by generosity; the liar by truth.',
      cite: 'Dhammapada 223' },
    { text: 'Let go of the past, let go of the future, let go of the present, and cross over to the farther shore.',
      cite: 'Dhammapada 348' },
    { text: 'Even as a mother protects her only child with her life, so with a boundless heart should one cherish all living beings.',
      cite: 'Karaniya Metta Sutta' },
    { text: 'In gladness and in safety, may all beings be at ease.',
      cite: 'Karaniya Metta Sutta' },
    { text: 'Searching all directions with your awareness, you find no one dearer than yourself. So do not hurt others.',
      cite: 'Udana 5.1' },
    { text: 'They don’t sorrow over the past, don’t long for the future. They survive on the present. That is why their faces are bright and serene.',
      cite: 'Samyutta Nikaya 1.10' },
    { text: 'You shouldn’t chase after the past or place expectations on the future. What is past is left behind.',
      cite: 'Majjhima Nikaya 131' },
    { text: 'Luminous, monks, is the mind.',
      cite: 'Anguttara Nikaya 1.49' },
    { text: 'Having admirable people as friends and companions is actually the whole of the holy life.',
      cite: 'Samyutta Nikaya 45.2' },
    { text: 'The mind is hard to hold, quick, alighting wherever it likes. Tamed, it brings happiness.',
      cite: 'Dhammapada 35' },
    { text: 'As a bee takes nectar and leaves the flower unharmed, so should the sage walk through the village.',
      cite: 'Dhammapada 49' },
    { text: 'Look not to the faults of others, nor what they have done or left undone. Look to your own.',
      cite: 'Dhammapada 50' },
    { text: 'The scent of flowers goes with the wind; the fragrance of a good heart travels against it, filling every direction.',
      cite: 'Dhammapada 54' },
    { text: 'As a deep lake is clear and still, so the wise grow calm on hearing the teaching.',
      cite: 'Dhammapada 82' },
    { text: 'Calm in mind, calm in speech, calm in deed: such is one freed by true knowing.',
      cite: 'Dhammapada 96' },
    { text: 'Village or forest, valley or hill — wherever the awakened dwell, that place is delightful.',
      cite: 'Dhammapada 98' },
    { text: 'Though you conquer a thousand thousand in battle, the noblest victory is over yourself.',
      cite: 'Dhammapada 103' },
    { text: 'Do not think lightly of good, thinking it will not come to you. Drop by drop the water jar is filled.',
      cite: 'Dhammapada 122' },
    { text: 'All beings tremble at violence; life is dear to all. Seeing yourself in others, harm no one.',
      cite: 'Dhammapada 130' },
    { text: 'Even splendid royal chariots wear out, and this body too grows old. But goodness never ages.',
      cite: 'Dhammapada 151' },
    { text: 'Do no harm, cultivate what is good, purify your own mind — this is the teaching of the awakened.',
      cite: 'Dhammapada 183' },
    { text: 'How happily we live, free from hostility among those who are hostile.',
      cite: 'Dhammapada 197' },
    { text: 'How happily we live, we who own nothing. We shall feed on joy, like the shining gods.',
      cite: 'Dhammapada 200' },
    { text: 'Little by little, moment by moment, the wise clear away their own flaws, as a silversmith refines silver.',
      cite: 'Dhammapada 239' },
    { text: 'Talking a great deal does not make one wise. Peaceful, friendly, unafraid — that one is called wise.',
      cite: 'Dhammapada 258' },
    { text: 'If giving up a small happiness reveals a greater one, the wise let the small one go.',
      cite: 'Dhammapada 290' },
    { text: 'The good shine from far away, like the snowy Himalayas.',
      cite: 'Dhammapada 304' },
    { text: 'Delight in awareness. Watch over your own mind. Lift yourself out of the mud, as an elephant does.',
      cite: 'Dhammapada 327' },
    { text: 'If you find a wise companion who lives well, walk with them gladly and mindfully, past every danger.',
      cite: 'Dhammapada 328' },
    { text: 'A blessing: friends when the need arises. A blessing: contentment with whatever you have.',
      cite: 'Dhammapada 331' },
    { text: 'In the seen, only the seen. In the heard, only the heard. In the sensed, only the sensed.',
      cite: 'Udana 1.10' },
    { text: 'Do not be afraid of acts of merit. This is another name for happiness.',
      cite: 'Itivuttaka 22' },
    { text: 'If beings knew, as I know, the results of giving and sharing, they would not eat without having given.',
      cite: 'Itivuttaka 26' },
    { text: 'As the moon outshines all the stars, so a heart of loving-kindness outshines every other way of making merit.',
      cite: 'Itivuttaka 27' },
    { text: 'A mind unshaken when touched by the ways of the world — sorrowless, stainless, at peace.',
      cite: 'Sutta Nipata 2.4' },
    { text: 'One who cultivates loving-kindness sleeps easily, wakes easily, dreams no evil dreams, and is dear to all beings.',
      cite: 'Anguttara Nikaya 11.16' },
    { text: 'A moment of good will — the time it takes to milk a cow — bears more fruit than a hundred gifts of food.',
      cite: 'Samyutta Nikaya 20.4' },
    { text: 'A giver of food gives strength. A giver of clothes gives beauty. A giver of a lamp gives sight.',
      cite: 'Samyutta Nikaya 1.42' },
    { text: 'My hut is roofed and comfortable, out of the wind; my mind is settled and free. So rain, sky, if you wish.',
      cite: 'Theragatha 1.1' },
    { text: 'Having come to the foot of a tree, I meditate, absorbed in the bliss: What bliss!',
      cite: 'Therigatha 2.3' },
    { text: 'Speak at the right time, in truth, affectionately, beneficially, and with a mind of good will.',
      cite: 'Anguttara Nikaya 5.198' },
    { text: 'Whoever does not flare up at someone who is angry wins a battle hard to win.',
      cite: 'Samyutta Nikaya 11.5' },
    { text: 'I crossed the flood without pushing forward, without standing still.',
      cite: 'Samyutta Nikaya 1.1' },
    { text: 'Intention is the leader of things; intention is first, they’re made by intention. If with corrupt intent you speak or act, suffering follows you, like a wheel, the ox’s foot.',
      cite: 'Dhammapada 1' },
    { text: '“They abused me, they hit me! They beat me, they robbed me!” For those who bear such a grudge, hatred is never laid to rest.',
      cite: 'Dhammapada 3' },
    { text: '“They abused me, they hit me! They beat me, they robbed me!” For those who bear no such grudge, hatred is laid to rest.',
      cite: 'Dhammapada 4' },
    { text: 'When others do not understand, let us, who do understand this, restrain ourselves in this regard; for that is how conflicts are laid to rest.',
      cite: 'Dhammapada 6' },
    { text: 'Those who contemplate the beautiful, their faculties unrestrained, immoderate in eating, lazy, lacking energy: Māra strikes them down like the wind, a feeble tree.',
      cite: 'Dhammapada 7' },
    { text: 'Those who contemplate the ugly, their faculties well-restrained, eating in moderation, faithful and energetic: Māra cannot strike them down, like the wind, a rocky mountain.',
      cite: 'Dhammapada 8' },
    { text: 'Thinking the inessential is essential, seeing the essential as inessential; they don’t realize the essential, for wrong thoughts are their habitat.',
      cite: 'Dhammapada 11' },
    { text: 'Having known the essential as essential, and the inessential as inessential; they realize the essential, for right thoughts are their habitat.',
      cite: 'Dhammapada 12' },
    { text: 'Just as rain seeps into a poorly roofed house, lust seeps into an undeveloped mind.',
      cite: 'Dhammapada 13' },
    { text: 'Just as rain doesn’t seep into a well roofed house, lust doesn’t seep into a well developed mind.',
      cite: 'Dhammapada 14' },
    { text: 'Here they grieve, hereafter they grieve, an evildoer grieves in both places. They grieve and fret, seeing their own corrupt deeds.',
      cite: 'Dhammapada 15' },
    { text: 'Here they rejoice, hereafter they rejoice, one who does good rejoices in both places. They rejoice and celebrate, seeing their own pure deeds.',
      cite: 'Dhammapada 16' },
    { text: 'Here they’re tormented, <j>hereafter they’re tormented, an evildoer is tormented in both places. They’re tormented <j>thinking of bad things they’ve done; when gone to a bad place, <j>they’re tormented all the more.',
      cite: 'Dhammapada 17' },
    { text: 'Here they delight, hereafter they delight, one who does good delights in both places. They delight thinking of good things they’ve done; when gone to a good place, they delight all the more.',
      cite: 'Dhammapada 18' },
    { text: 'Much though they may recite scripture, if a negligent person does not apply them, then, like a cowherd who counts the cattle of others, they miss out on the blessings of the ascetic life.',
      cite: 'Dhammapada 19' },
    { text: 'Heedfulness is the state free of death; heedlessness is the state of death. The heedful do not die, while the heedless are like the dead.',
      cite: 'Dhammapada 21' },
    { text: 'Understanding this distinction when it comes to heedfulness, the astute rejoice in heedfulness, happy in the noble ones’ domain.',
      cite: 'Dhammapada 22' },
    { text: 'They who regularly meditate, always staunchly vigorous; the attentive realize extinguishment, the supreme sanctuary from the yoke.',
      cite: 'Dhammapada 23' },
    { text: 'For the hard-working and mindful, pure of deed and attentive, restrained, living righteously, and diligent, their reputation only grows.',
      cite: 'Dhammapada 24' },
    { text: 'By hard work and diligence, by restraint and by self-control, a smart person would build an island that the floods cannot overflow.',
      cite: 'Dhammapada 25' },
    { text: 'Fools and simpletons devote themselves to negligence. But the wise protect diligence as their best treasure.',
      cite: 'Dhammapada 26' },
    { text: 'Don’t devote yourself to negligence, or delight in erotic intimacy. For if you’re diligent and meditate, you’ll attain abundant happiness.',
      cite: 'Dhammapada 27' },
    { text: 'When the astute dispel negligence by means of diligence, ascending the palace of wisdom, sorrowless, they behold this generation of sorrow, as an attentive one on a mountain top beholds the fools below.',
      cite: 'Dhammapada 28' },
    { text: 'Heedful among the heedless, wide awake while others sleep— a true sage leaves them behind, like a swift horse passing a feeble.',
      cite: 'Dhammapada 29' },
    { text: 'Maghavā became chief of the gods by means of diligence. People praise diligence, while negligence is always deplored.',
      cite: 'Dhammapada 30' },
    { text: 'A mendicant who loves diligence, seeing fear in negligence— advances like fire, burning up fetters big and small.',
      cite: 'Dhammapada 31' },
    { text: 'A mendicant who loves diligence, seeing fear in negligence— such a one can’t decline, and has drawn near to extinguishment.',
      cite: 'Dhammapada 32' },
    { text: 'The mind quivers and quakes, hard to guard, hard to curb. The discerning straighten it out, like a fletcher an arrow.',
      cite: 'Dhammapada 33' },
    { text: 'Like a fish pulled from the sea and cast upon the shore, this mind flounders about, trying to throw off Māra’s dominion.',
      cite: 'Dhammapada 34' },
    { text: 'So hard to see, so subtle, alighting where it will; the discerning protect the mind, a guarded mind leads to bliss.',
      cite: 'Dhammapada 36' },
    { text: 'The mind travels far, wandering alone; incorporeal, it lies hidden in the heart. Those who will restrain the mind are freed from Māra’s bonds.',
      cite: 'Dhammapada 37' },
    { text: 'Those of unsteady mind, who don’t understand the true teaching, and whose confidence wavers, do not perfect their wisdom.',
      cite: 'Dhammapada 38' },
    { text: 'One whose mind is not festering, whose heart is undamaged, who’s given up right and wrong, alert, has nothing to fear.',
      cite: 'Dhammapada 39' },
    { text: 'Knowing this body breaks like a pot, and fortifying the mind like a citadel, attack Māra with the sword of wisdom, guard your conquest, and never settle.',
      cite: 'Dhammapada 40' },
    { text: 'All too soon this body will lie upon the earth, bereft of consciousness, tossed aside like a worthless log.',
      cite: 'Dhammapada 41' },
    { text: 'A wrongly directed mind would do you more harm than a hater to the hated, or an enemy to their foe.',
      cite: 'Dhammapada 42' },
    { text: 'Who bestirs this earth, and the Yama realm with its gods? Who sets out the well-taught word of truth, as an expert a flower?',
      cite: 'Dhammapada 44' },
    { text: 'A trainee bestirs this earth, and the Yama realm with its gods. A trainee sets out the well-taught word of truth, as an expert a flower.',
      cite: 'Dhammapada 45' },
    { text: 'Knowing this body’s like foam, realizing it’s all just a mirage, and cutting off Māra’s blossoming, vanish from the King of Death.',
      cite: 'Dhammapada 46' },
    { text: 'As a mighty flood sweeps off a sleeping village, death steals away a man even as he gathers flowers, his mind caught up in them.',
      cite: 'Dhammapada 47' },
    { text: 'The terminator gains control of the man who has not had his fill of pleasures, even as he gathers flowers, his mind caught up in them.',
      cite: 'Dhammapada 48' },
    { text: 'Just like a glorious flower that’s colorful but lacks fragrance; eloquent speech is fruitless for one who does not act on it.',
      cite: 'Dhammapada 51' },
    { text: 'Just like a glorious flower that’s both colorful and fragrant, eloquent speech is fruitful for one who acts on it.',
      cite: 'Dhammapada 52' },
    { text: 'Just as one would create many garlands from a heap of flowers, when a person has come to be born, they should do many skillful things.',
      cite: 'Dhammapada 53' },
    { text: 'Among all the fragrances— sandalwood or pinwheel or lotus or jasmine— the fragrance of virtue is supreme.',
      cite: 'Dhammapada 55' },
    { text: 'Faint is the fragrance of sandal or pinwheel; but the fragrance of the virtuous floats to the highest gods.',
      cite: 'Dhammapada 56' },
    { text: 'For those accomplished in ethics, meditating diligently, freed through the highest knowledge, Māra cannot find their path.',
      cite: 'Dhammapada 57' },
    { text: 'From a heap of trash discarded on the highway, a lotus might blossom, fragrant and delightful.',
      cite: 'Dhammapada 58' },
    { text: 'So too, among those thought of as trash, a disciple of the perfect Buddha outshines with their wisdom the blind ordinary folk.',
      cite: 'Dhammapada 59' },
    { text: 'Long is the night for the wakeful; long is the league for the weary; long transmigrate the fools who don’t understand the true teaching.',
      cite: 'Dhammapada 60' },
    { text: 'If while wandering you find no partner equal or better than yourself, then firmly resolve to wander alone— there’s no fellowship with fools.',
      cite: 'Dhammapada 61' },
    { text: '“Sons are mine, wealth is mine”— thus the fool frets. For even your self is not your own, let alone your sons or wealth.',
      cite: 'Dhammapada 62' },
    { text: 'The fool who thinks they’re a fool is wise at least to that extent. But the true fool is said to be one who imagines that they are wise.',
      cite: 'Dhammapada 63' },
    { text: 'Though a fool attends to the wise even for the rest of their life, they still don’t understand the teaching, like a spoon the taste of the soup.',
      cite: 'Dhammapada 64' },
    { text: 'If a clever person attends to the wise even just for an hour or so, they swiftly understand the teaching, like a tongue the taste of the soup.',
      cite: 'Dhammapada 65' },
    { text: 'Fools and simpletons behave like their own worst enemies, doing wicked deeds that ripen as bitter fruit.',
      cite: 'Dhammapada 66' },
    { text: 'It’s not good to do a deed that plagues you later on, for which you weep and wail, as its effect stays with you.',
      cite: 'Dhammapada 67' },
    { text: 'It is good to do a deed that doesn’t plague you later on, that gladdens and cheers, as its effect stays with you.',
      cite: 'Dhammapada 68' },
    { text: 'The fool imagines that evil is sweet, so long as it has not yet ripened. But as soon as that evil ripens, they fall into suffering.',
      cite: 'Dhammapada 69' },
    { text: 'Month after month a fool may eat food from a grass-blade’s tip; but they’ll never be worth a sixteenth part of one who has appraised the teaching.',
      cite: 'Dhammapada 70' },
    { text: 'For a wicked deed that has been done does not curdle quickly like milk. Smoldering, it follows the fool, like a fire smothered over with ash.',
      cite: 'Dhammapada 71' },
    { text: 'Whatever fame a fool may get, it only gives rise to harm. Whatever good features they have it ruins, and blows their head into bits.',
      cite: 'Dhammapada 72' },
    { text: 'They’d seek the esteem that they lack, and status among the mendicants; authority over monasteries, and honor among other families.',
      cite: 'Dhammapada 73' },
    { text: 'Advise and instruct; curb wickedness: for you shall be loved by the good, and disliked by the bad.',
      cite: 'Dhammapada 77' },
    { text: 'Don’t mix with bad friends, nor with the worst of men. Mix with spiritual friends, and with the best of men.',
      cite: 'Dhammapada 78' },
    { text: 'Through joy in the teaching you sleep at ease, with clear and confident heart. An astute person always delights in the teaching proclaimed by the Noble One.',
      cite: 'Dhammapada 79' },
    { text: 'While irrigators guide water, fletchers bend arrows straight, and carpenters bend timber straight, the astute tame themselves.',
      cite: 'Dhammapada 80' },
    { text: 'True persons give up everything, they don’t cajole for the things they desire. Though touched by sadness or happiness, the astute appear neither depressed nor elated.',
      cite: 'Dhammapada 83' },
    { text: 'Never wish for success by unjust means, for your own sake or that of another, desiring children, wealth, or nation; rather, be virtuous, wise, and just.',
      cite: 'Dhammapada 84' },
    { text: 'Few are those among humans who cross to the far shore. The rest just run around on the near shore.',
      cite: 'Dhammapada 85' },
    { text: 'When the teaching is well explained, the people who practice accordingly will cross over Death’s dominion so hard to pass.',
      cite: 'Dhammapada 86' },
    { text: 'Rid of dark qualities, an astute person would develop the bright. Having left home for homelessness in seclusion, where joy is hard,',
      cite: 'Dhammapada 87' },
    { text: 'they’d long for satisfaction there. Forsaking sensual pleasures, owning nothing, an astute person would cleanse themselves of mental corruptions.',
      cite: 'Dhammapada 88' },
    { text: 'And those whose minds are rightly developed in the awakening factors; who, letting go of attachments, delight in not grasping: with defilements ended, brilliant, they are quenched in this world.',
      cite: 'Dhammapada 89' },
    { text: 'At journey’s end, rid of sorrow; everywhere free, all ties given up, no fever is found in them.',
      cite: 'Dhammapada 90' },
    { text: 'The mindful apply themselves; they delight in no abode. Like a swan gone from the marsh, they leave home after home behind.',
      cite: 'Dhammapada 91' },
    { text: 'Those with nothing stored up, who have understood their food, whose domain is the liberation of the signless and the empty: their path is hard to trace, like birds in the sky.',
      cite: 'Dhammapada 92' },
    { text: 'One whose defilements have ended; who’s not attached to food; whose domain is the liberation of the signless and the empty: their track is hard to trace, like birds in the sky.',
      cite: 'Dhammapada 93' },
    { text: 'Whose faculties have become serene, like horses tamed by a charioteer, who has abandoned conceit and defilements; the unaffected one is envied by even the gods.',
      cite: 'Dhammapada 94' },
    { text: 'Undisturbed like the earth, true to their vows, steady as Indra’s pillar, like a lake clear of mud; such a one does not transmigrate.',
      cite: 'Dhammapada 95' },
    { text: 'Lacking faith, a house-breaker, one who acknowledges nothing, purged of hope, they’ve wasted their chance: that is indeed the supreme person!',
      cite: 'Dhammapada 97' },
    { text: 'Delightful are the wildernesses where no people delight. Those free of greed will delight there, not those who seek sensual pleasures.',
      cite: 'Dhammapada 99' },
    { text: 'Better than a thousand meaningless verses is a single meaningful verse, hearing which brings you peace.',
      cite: 'Dhammapada 101' },
    { text: 'Better than reciting a hundred meaningless verses is a single saying of Dhamma, hearing which brings you peace.',
      cite: 'Dhammapada 102' },
    { text: 'It is surely better to conquer oneself than all those other folk. When a person has tamed themselves, always living restrained,',
      cite: 'Dhammapada 104' },
    { text: 'no god nor centaur, nor Māra nor divinity, can undo the victory of such a personage.',
      cite: 'Dhammapada 105' },
    { text: 'Rather than a thousandfold sacrifice, every month for a full century, it’s better to honor for a single hour one who has developed themselves. That offering is better than the hundred year sacrifice.',
      cite: 'Dhammapada 106' },
    { text: 'Whatever sacrifice or offering in the world a seeker of merit may make for a year, none of it is worth a quarter of bowing to the sincere.',
      cite: 'Dhammapada 108' },
    { text: 'For one in the habit of bowing, always honoring the elders, four blessings grow: lifespan, beauty, happiness, and strength.',
      cite: 'Dhammapada 109' },
    { text: 'Better to live a single day ethical and absorbed in meditation than to live a hundred years unethical and lacking immersion.',
      cite: 'Dhammapada 110' },
    { text: 'Better to live a single day wise and absorbed in meditation than to live a hundred years witless and lacking immersion.',
      cite: 'Dhammapada 111' },
    { text: 'Better to live a single day energetic and strong, than to live a hundred years lazy and lacking energy.',
      cite: 'Dhammapada 112' },
    { text: 'Better to live a single day seeing rise and fall than to live a hundred years blind to rise and fall.',
      cite: 'Dhammapada 113' },
    { text: 'Better to live a single day seeing the state free of death than to live a hundred years blind to the state free of death.',
      cite: 'Dhammapada 114' },
    { text: 'Better to live a single day seeing the supreme teaching than to live a hundred years blind to the supreme teaching.',
      cite: 'Dhammapada 115' },
    { text: 'Rush to do good, shield your mind from evil; for when you’re slow to do good, your thoughts delight in wickedness.',
      cite: 'Dhammapada 116' },
    { text: 'If you do something bad, don’t do it again and again, don’t set your heart on it, for piling up evil is suffering.',
      cite: 'Dhammapada 117' },
    { text: 'If you do something good, do it again and again, set your heart on it, for piling up goodness is joyful.',
      cite: 'Dhammapada 118' },
    { text: 'Even the wicked see good things, so long as their wickedness has not ripened. But as soon as that wickedness ripens, then the wicked see wicked things.',
      cite: 'Dhammapada 119' },
    { text: 'Even the good see wicked things, so long as their goodness has not ripened. But as soon as that goodness ripens, then the good see good things.',
      cite: 'Dhammapada 120' },
    { text: 'Think not lightly of evil, that it won’t come back to you. The pot is filled with water falling drop by drop; the fool is filled with wickedness piled up bit by bit.',
      cite: 'Dhammapada 121' },
    { text: 'Avoid wickedness, as a merchant with rich cargo and small escort would avoid a dangerous road, or one who loves life would avoid drinking poison.',
      cite: 'Dhammapada 123' },
    { text: 'You can carry poison in your hand if it has no wound, for poison does not infect without a wound; nothing bad happens unless you do bad.',
      cite: 'Dhammapada 124' },
    { text: 'Whoever wrongs a man who has done no wrong, a pure man who has not a blemish, the evil backfires on the fool, like fine dust thrown upwind.',
      cite: 'Dhammapada 125' },
    { text: 'Not in midair, nor mid-ocean, nor hiding in a mountain cleft; you’ll find no place on the planet to escape your wicked deeds.',
      cite: 'Dhammapada 127' },
    { text: 'Not in midair, nor mid-ocean, nor hiding in a mountain cleft; you’ll find no place on the planet where you won’t be vanquished by death.',
      cite: 'Dhammapada 128' },
    { text: 'All tremble at the rod, all fear death. Treating others like oneself, neither kill nor incite to kill.',
      cite: 'Dhammapada 129' },
    { text: 'Creatures love happiness, so if you harm them with a stick in search of your own happiness, after death you won’t find happiness.',
      cite: 'Dhammapada 131' },
    { text: 'Creatures love happiness, so if you don’t harm them with a stick in search of your own happiness, after death you will find happiness.',
      cite: 'Dhammapada 132' },
    { text: 'Don’t speak harshly, they may speak harshly back. For aggressive speech is painful, and the rod may spring back on you.',
      cite: 'Dhammapada 133' },
    { text: 'If you still yourself like a broken gong, you reach extinguishment and know no conflict.',
      cite: 'Dhammapada 134' },
    { text: 'As a cowherd drives the cows to pasture with the rod, so too old age and death drive life from living beings.',
      cite: 'Dhammapada 135' },
    { text: 'The fool does not understand the evil that they do. But because of those deeds, that simpleton is tormented as if burnt by fire.',
      cite: 'Dhammapada 136' },
    { text: 'One who violently attacks the peaceful and the innocent swiftly falls to one of ten bad states:',
      cite: 'Dhammapada 137' },
    { text: 'harsh pain; loss; the breakup of the body; serious illness; mental distress;',
      cite: 'Dhammapada 138' },
    { text: 'hazards from rulers; vicious slander; loss of kin; destruction of wealth;',
      cite: 'Dhammapada 139' },
    { text: 'Not nudity, nor matted hair, nor mud, nor fasting, nor lying on bare ground, nor wearing dust and dirt, or squatting on the heels, will cleanse a mortal not free of doubt.',
      cite: 'Dhammapada 141' },
    { text: 'Dressed up they may be, but if they live well— peaceful, tamed, committed to the spiritual path, having laid aside violence toward all creatures— they are a brahmin, an ascetic, a mendicant.',
      cite: 'Dhammapada 142' },
    { text: 'Can a person constrained by conscience be found in the world? Who shies away from blame, like a fine horse from the whip?',
      cite: 'Dhammapada 143' },
    { text: 'Like a fine horse under the whip, be keen and full of urgency. With faith, ethics, and energy, immersion, and investigation of principles, accomplished in knowledge and conduct, mindful, give up this vast suffering.',
      cite: 'Dhammapada 144' },
    { text: 'While irrigators guide water, fletchers bend arrows straight, and carpenters bend timber straight, those true to their vows tame themselves.',
      cite: 'Dhammapada 145' },
    { text: 'What is joy, what is laughter, when the flames are ever burning? Swathed in darkness, would you not seek a light?',
      cite: 'Dhammapada 146' },
    { text: 'See this fancy puppet, a body built of sores, diseased, obsessed over, in which nothing lasts at all.',
      cite: 'Dhammapada 147' },
    { text: 'A person of little learning ages like an ox— their flesh grows, but not their wisdom.',
      cite: 'Dhammapada 152' },
    { text: 'Transmigrating through countless rebirths, I’ve journeyed without reward, searching for the house-builder; painful is birth again and again.',
      cite: 'Dhammapada 153' },
    { text: 'I’ve seen you, house-builder! You won’t build a house again! Your rafters are all broken, your roof-peak demolished. The mind, set on demolition, has reached the end of cravings.',
      cite: 'Dhammapada 154' },
    { text: 'When young they spurned the spiritual path and failed to earn any wealth. Now they brood like old cranes in a pond bereft of fish.',
      cite: 'Dhammapada 155' },
    { text: 'When young they spurned the spiritual path and failed to earn any wealth. Now they lie like spent arrows, bemoaning over things past.',
      cite: 'Dhammapada 156' },
    { text: 'If you knew your self as beloved, you’d look after it so well. In one of the night’s three watches, an astute person would remain alert.',
      cite: 'Dhammapada 157' },
    { text: 'The astute would avoid being corrupted by first grounding themselves in what is suitable, and then instructing others.',
      cite: 'Dhammapada 158' },
    { text: 'If one were to treat oneself as one instructs another, the well-tamed indeed would tame: for the self, it seems, is hard to tame.',
      cite: 'Dhammapada 159' },
    { text: 'One is indeed the lord of oneself, for who else would be one’s lord? By means of a well-tamed self, one gains a lord that’s rare indeed.',
      cite: 'Dhammapada 160' },
    { text: 'For the evil that is done by oneself, born and produced in oneself, grinds down a simpleton, as diamond grinds a lesser gem.',
      cite: 'Dhammapada 161' },
    { text: 'One choked by immorality, as a sal tree by a creeper, does to themselves what a foe only wishes.',
      cite: 'Dhammapada 162' },
    { text: 'It’s easy to do bad things harmful to oneself, but good things that are helpful are the hardest things to do.',
      cite: 'Dhammapada 163' },
    { text: 'On account of wicked views— scorning the guidance of the perfected ones, the noble ones living righteously— the idiot begets their own self’s demise, like the bamboo bearing fruit.',
      cite: 'Dhammapada 164' },
    { text: 'Never neglect what is good for yourself for the sake of another, however great. Knowing well what is good for yourself, be intent upon your heart’s goal.',
      cite: 'Dhammapada 166' },
    { text: 'Don’t resort to lowly things, don’t abide in negligence, don’t resort to wrong views, don’t perpetuate the world.',
      cite: 'Dhammapada 167' },
    { text: 'Get up, don’t be heedless, live by principle, with good conduct. For one of good conduct sleeps at ease, in this world and the next.',
      cite: 'Dhammapada 168' },
    { text: 'Live by principle, with good conduct, don’t conduct yourself badly. For one of good conduct sleeps at ease, in this world and the next.',
      cite: 'Dhammapada 169' },
    { text: 'Look upon the world as a bubble or a mirage, then the King of Death won’t see you.',
      cite: 'Dhammapada 170' },
    { text: 'Come, see this world decked out like a fancy royal chariot. Here fools founder, but the discerning are not chained.',
      cite: 'Dhammapada 171' },
    { text: 'He who once was heedless, but turned to heedfulness, shines upon this world like the moon freed from clouds.',
      cite: 'Dhammapada 172' },
    { text: 'Someone whose bad deed is supplanted by the good, shines upon this world, like the moon freed from clouds.',
      cite: 'Dhammapada 173' },
    { text: 'Blind is the world, few are those who clearly see. Only a handful go to heaven, like a bird freed from a net.',
      cite: 'Dhammapada 174' },
    { text: 'Swans fly by the sun’s path, psychic sages fly through space. The attentive leave the world, having vanquished Māra with his legions.',
      cite: 'Dhammapada 175' },
    { text: 'When a personage, spurning the hereafter, transgresses in just one thing— lying— there is no evil they would not do.',
      cite: 'Dhammapada 176' },
    { text: 'The miserly don’t ascend to heaven, it takes a fool to not praise giving. The attentive celebrate giving, and so find happiness in the hereafter.',
      cite: 'Dhammapada 177' },
    { text: 'The fruit of stream-entry is better than being the one king of the earth, than going to heaven, than lordship over all the world.',
      cite: 'Dhammapada 178' },
    { text: 'He whose victory may not be undone, a victory unrivaled in all the world; by what track would you trace that Buddha, who leaves no track in his infinite range?',
      cite: 'Dhammapada 179' },
    { text: 'Of craving, the weaver, the clinger, he has none: so where can he be traced? By what track would you trace that Buddha, who leaves no track in his infinite range?',
      cite: 'Dhammapada 180' },
    { text: 'It’s hard to gain a human birth; the life of mortals is hard; it’s hard to hear the true teaching; the arising of Buddhas is hard.',
      cite: 'Dhammapada 182' },
    { text: 'Patient acceptance is the ultimate fervor. Extinguishment is the ultimate, say the Buddhas. No true renunciate injures another, nor does an ascetic hurt another.',
      cite: 'Dhammapada 184' },
    { text: 'Not speaking ill nor doing harm; restraint in the monastic code; moderation in eating; staying in remote lodgings; commitment to the higher mind— this is the instruction of the Buddhas.',
      cite: 'Dhammapada 185' },
    { text: 'Even if it were raining money, you’d not be sated in sensual pleasures. An astute person understands that sensual pleasures offer little gratification and much suffering.',
      cite: 'Dhammapada 186' },
    { text: 'Thus they find no delight even in celestial pleasures. A disciple of the fully awakened Buddha delights in the ending of craving.',
      cite: 'Dhammapada 187' },
    { text: 'So many go for refuge to mountains and forest groves, to shrines in tended parks; those people are driven by fear.',
      cite: 'Dhammapada 188' },
    { text: 'But such refuge is no sanctuary, it is no supreme refuge. By going to that refuge, you’re not released from all suffering.',
      cite: 'Dhammapada 189' },
    { text: 'One gone for refuge to the Buddha, to his teaching and to the Saṅgha, sees the four noble truths with right understanding:',
      cite: 'Dhammapada 190' },
    { text: 'suffering, suffering’s origin, suffering’s transcendence, and the noble eightfold path that leads to the stilling of suffering.',
      cite: 'Dhammapada 191' },
    { text: 'Such refuge is a sanctuary, it is the supreme refuge. By going to that refuge, you’re released from all suffering.',
      cite: 'Dhammapada 192' },
    { text: 'It’s hard to find a thoroughbred man: they’re not born just anywhere. A family where that attentive one is born prospers in happiness.',
      cite: 'Dhammapada 193' },
    { text: 'Happy, the arising of Buddhas! Happy, the teaching of Dhamma! Happy is the harmony of the Saṅgha, and the striving of the harmonious is happy.',
      cite: 'Dhammapada 194' },
    { text: 'When a person venerates the worthy— the Buddha or his disciple, who have transcended proliferation, and have left behind grief and lamentation,',
      cite: 'Dhammapada 195' },
    { text: 'quenched, fearing nothing from any quarter— the merit of one venerating such as these, cannot be calculated by anyone, saying it is just this much.',
      cite: 'Dhammapada 196' },
    { text: 'Let us live so very happily, healthy among the ailing. Among ailing humans let us live healthily.',
      cite: 'Dhammapada 198' },
    { text: 'Let us live so very happily, content among the greedy. Among greedy humans, let us live content.',
      cite: 'Dhammapada 199' },
    { text: 'Hunger is the worst illness, conditions are the worst suffering. When one has known this as it is, extinguishment is the ultimate happiness.',
      cite: 'Dhammapada 203' },
    { text: 'Having drunk the nectar of seclusion and the nectar of peace— free of stress, free of evil, drink the joyous nectar of truth.',
      cite: 'Dhammapada 205' },
    { text: 'It’s good to see the noble ones, staying with them is always good. Were you not to see fools, you’d always be happy.',
      cite: 'Dhammapada 206' },
    { text: 'For one who consorts with fools grieves long. Painful is living with fools, like being stuck with your enemy. Happy is living with an attentive one, like meeting with your kin.',
      cite: 'Dhammapada 207' },
    { text: 'Therefore: An attentive one, wise and learned, a behemoth of virtue, true to their vows, noble: follow a true and intelligent person such as this, as the moon tracks the path of the stars.',
      cite: 'Dhammapada 208' },
    { text: 'Applying yourself where you ought not, neglecting what you should be doing, forgetting your goal, you cling to what you hold dear, jealous of those devoted to their heart’s goal.',
      cite: 'Dhammapada 209' },
    { text: 'Don’t ever get too close to those you like or dislike. For not seeing the liked is suffering, and so is seeing the disliked.',
      cite: 'Dhammapada 210' },
    { text: 'Therefore don’t hold anything dear, for it’s bad to lose those you love. No ties are found in they who hold nothing loved or loathed.',
      cite: 'Dhammapada 211' },
    { text: 'Sorrow springs from what we hold dear, fear springs from what we hold dear; one free from holding anything dear has no sorrow, let alone fear.',
      cite: 'Dhammapada 212' },
    { text: 'Sorrow springs from attachment, fear springs from attachment; one free from attachment has no sorrow, let alone fear.',
      cite: 'Dhammapada 213' },
    { text: 'Sorrow springs from relishing, fear springs from relishing; one free from relishing has no sorrow, let alone fear.',
      cite: 'Dhammapada 214' },
    { text: 'Sorrow springs from desire, fear springs from desire; one free from desire has no sorrow, let alone fear.',
      cite: 'Dhammapada 215' },
    { text: 'Sorrow springs from craving, fear springs from craving; one free from craving has no sorrow, let alone fear.',
      cite: 'Dhammapada 216' },
    { text: 'One accomplished in virtue and vision, firmly principled, and truthful, doing oneself what ought be done: that’s who the people love.',
      cite: 'Dhammapada 217' },
    { text: 'One eager to realize the ineffable would be filled with awareness. Their mind not bound to pleasures of sense, they’re said to be heading upstream.',
      cite: 'Dhammapada 218' },
    { text: 'When a man returns safely after a long time spent abroad, family, friends, and loved ones celebrate his return.',
      cite: 'Dhammapada 219' },
    { text: 'Just so, when one who has done good goes from this world to the next, their good deeds receive them there, as family welcomes home one they love.',
      cite: 'Dhammapada 220' },
    { text: 'Give up anger, get rid of conceit, and escape every fetter. Sufferings don’t befall one who has nothing, not clinging to name and form.',
      cite: 'Dhammapada 221' },
    { text: 'When anger surges like a lurching chariot, keep it in check. That’s what I call a charioteer; others just hold the reins.',
      cite: 'Dhammapada 222' },
    { text: 'Speak the truth, do not be angry, and give when asked, if only a little. By these three means, you may enter the presence of the gods.',
      cite: 'Dhammapada 224' },
    { text: 'Those harmless sages, always restrained in body, go to the state that does not pass, where there is no sorrow.',
      cite: 'Dhammapada 225' },
    { text: 'Always wakeful, practicing night and day, focused only on extinguishment, their defilements come to an end.',
      cite: 'Dhammapada 226' },
    { text: 'There never was, nor will be, nor is there today, someone who is wholly praised or wholly blamed.',
      cite: 'Dhammapada 228' },
    { text: 'If, after watching them day in day out, discerning people praise that sage of impeccable conduct, endowed with ethics and wisdom;',
      cite: 'Dhammapada 229' },
    { text: 'like a pendant of Black Plum River gold, who is worthy to criticize them? Even the gods praise them, and by the Divinity, too, they’re praised.',
      cite: 'Dhammapada 230' },
    { text: 'Guard against ill-tempered deeds, be restrained in body. Giving up bad bodily conduct, conduct yourself well in body.',
      cite: 'Dhammapada 231' },
    { text: 'Guard against ill-tempered words, be restrained in speech. Giving up bad verbal conduct, conduct yourself well in speech.',
      cite: 'Dhammapada 232' },
    { text: 'Guard against ill-tempered thoughts, be restrained in mind. Giving up bad mental conduct, conduct yourself well in mind.',
      cite: 'Dhammapada 233' },
    { text: 'An attentive one is restrained in body restrained also in speech, in thought, too, they are restrained: they are restrained in every way.',
      cite: 'Dhammapada 234' },
    { text: 'Today you’re like a withered leaf, Yama’s men await you. You stand at the departure gates, yet you have no supplies for the road.',
      cite: 'Dhammapada 235' },
    { text: 'Make an island of yourself! Swiftly strive, learn to be wise! Purged of stains, flawless, you’ll go to the heavenly realm of the noble ones.',
      cite: 'Dhammapada 236' },
    { text: 'You’ve journeyed the stages of life, and now you set out to meet Yama. Along the way there’s nowhere to stay, yet you have no supplies for the road.',
      cite: 'Dhammapada 237' },
    { text: 'Make an island of yourself! Swiftly strive, learn to be wise! Purged of stains, flawless, you’ll not come again to rebirth and old age.',
      cite: 'Dhammapada 238' },
    { text: 'It is the rust born on the iron that eats away the place it arose. And so it is their own deeds that lead the overly-ascetic to a bad place.',
      cite: 'Dhammapada 240' },
    { text: 'Not rehearsing is the stain of hymns. The stain of houses is neglect. Laziness is the stain of beauty. A guard’s stain is negligence.',
      cite: 'Dhammapada 241' },
    { text: 'Misconduct is a woman’s stain. A giver’s stain is stinginess. Bad qualities are a stain in this world and the next.',
      cite: 'Dhammapada 242' },
    { text: 'But a worse stain than these is ignorance, the worst stain of all. Having given up that stain, be without stains, mendicants!',
      cite: 'Dhammapada 243' },
    { text: 'Life is easy for the shameless. With all the rude courage of a crow, they live pushy, rude, and corrupt.',
      cite: 'Dhammapada 244' },
    { text: 'Life is hard for the conscientious, always seeking purity, neither clinging nor rude, pure of livelihood and discerning.',
      cite: 'Dhammapada 245' },
    { text: 'Take anyone in this world who kills living creatures, speaks falsely, steals, commits adultery,',
      cite: 'Dhammapada 246' },
    { text: 'and indulges in drinking beer and wine. Right here they dig up the root of their own self.',
      cite: 'Dhammapada 247' },
    { text: 'Know this, my man: they are unrestrained and wicked. Don’t let that greed and unrighteousness inflict pain on you for long.',
      cite: 'Dhammapada 248' },
    { text: 'The people give according to their faith, according to their confidence. If you get upset over that, over others’ food and drink, you’ll not, by day or by night, become immersed in samādhi.',
      cite: 'Dhammapada 249' },
    { text: 'Those who have cut that out, dug it up at the root, eradicated it, they will, by day or by night, become immersed in samādhi.',
      cite: 'Dhammapada 250' },
    { text: 'There is no fire like greed, no crime like hate, no net like delusion, no river like craving.',
      cite: 'Dhammapada 251' },
    { text: 'When you look for the flaws of others, always finding fault, your defilements only grow, you’re far from ending defilements.',
      cite: 'Dhammapada 253' },
    { text: 'In the atmosphere there is no track, there’s no true ascetic outside here. People enjoy proliferation, the Realized Ones are free of proliferation.',
      cite: 'Dhammapada 254' },
    { text: 'In the atmosphere there is no track, there’s no true ascetic outside here. No conditions last forever, the Awakened Ones are not shaken.',
      cite: 'Dhammapada 255' },
    { text: 'You don’t become just by passing hasty judgment. An astute person evaluates both what is pertinent and what is irrelevant.',
      cite: 'Dhammapada 256' },
    { text: 'A wise one judges others without haste, justly and impartially; that guardian of the law is said to be just.',
      cite: 'Dhammapada 257' },
    { text: 'You don’t become a senior by getting some grey hairs; for one ripe only in age, is said to have aged in vain.',
      cite: 'Dhammapada 260' },
    { text: 'One who is truthful and principled, harmless, restrained, and self-controlled, attentive, purged of stains, is said to be a senior.',
      cite: 'Dhammapada 261' },
    { text: 'Not by mere enunciation, or a beautiful complexion does a person become holy, if they’re jealous, stingy, and devious.',
      cite: 'Dhammapada 262' },
    { text: 'But if they’ve cut that out, dug it up at the root, eradicated it, that intelligent one, purged of vice, is said to be holy.',
      cite: 'Dhammapada 263' },
    { text: 'A liar and breaker of vows is no ascetic just because they shave their head. How on earth can one be an ascetic who’s full of desire and greed?',
      cite: 'Dhammapada 264' },
    { text: 'One who stops all wicked deeds, great and small, because of stopping wicked deeds is said to be an ascetic.',
      cite: 'Dhammapada 265' },
    { text: 'You don’t become a mendicant just by begging from others. One who has undertaken domestic duties has not yet become a mendicant.',
      cite: 'Dhammapada 266' },
    { text: 'But one living a spiritual life, who has banished both merit and evil, who wanders having appraised the world, is said to be a mendicant.',
      cite: 'Dhammapada 267' },
    { text: 'You don’t become a sage by being sagelike, while still confused and ignorant. The astute one who holds the scales, taking only the best,',
      cite: 'Dhammapada 268' },
    { text: 'and shunning the bad— that is a sage, <j>and that is how one becomes a sage. One who sagely weighs both in the world, is thereby said to be a sage.',
      cite: 'Dhammapada 269' },
    { text: 'You don’t become a noble one by harming living beings. One harmless toward all living beings is said to be a noble one.',
      cite: 'Dhammapada 270' },
    { text: 'Not by precepts and observances, nor by much learning, nor by meditative immersion, nor by living in seclusion,',
      cite: 'Dhammapada 271' },
    { text: 'do I experience the bliss of renunciation not frequented by ordinary people. A mendicant cannot rest confident without attaining the end of defilements.',
      cite: 'Dhammapada 272' },
    { text: 'Of paths, the eightfold is the best; of truths, the four statements; dispassion is the best of things, and the Clear-eyed One is the best of humans.',
      cite: 'Dhammapada 273' },
    { text: '<em>This</em> is the path, there is no other for the purification of vision. You all must practice this, it is the way to baffle Māra.',
      cite: 'Dhammapada 274' },
    { text: 'When you all are practicing this, you’ll make an end of suffering. I have explained the path to you for extracting the thorn with wisdom.',
      cite: 'Dhammapada 275' },
    { text: 'All conditions are impermanent— when this is seen with wisdom, one grows disillusioned with suffering: this is the path to purity.',
      cite: 'Dhammapada 277' },
    { text: 'All conditions are suffering— when this is seen with wisdom, one grows disillusioned with suffering: this is the path to purity.',
      cite: 'Dhammapada 278' },
    { text: 'All things are not-self— when this is seen with wisdom, one grows disillusioned with suffering: this is the path to purity.',
      cite: 'Dhammapada 279' },
    { text: 'They don’t get going when it’s time to start; they’re young and strong, but given to sloth. Their mind depressed in sunken thought, lazy and slothful, they can’t discern the path.',
      cite: 'Dhammapada 280' },
    { text: 'Guarded in speech, restrained in mind, doing no unskillful bodily deed. Purify these three ways of performing deeds, and win the path known to seers.',
      cite: 'Dhammapada 281' },
    { text: 'From meditation springs wisdom, without meditation, wisdom ends. Knowing these two paths— of progress and decline— you should conduct yourself so that wisdom grows.',
      cite: 'Dhammapada 282' },
    { text: 'Cut down the jungle, not just a tree; from the jungle springs fear. Having cut down jungle and snarl, be free of jungles, mendicants!',
      cite: 'Dhammapada 283' },
    { text: 'So long as the vine, no matter how small, that ties a man to women is not cut, his mind remains trapped, like a calf suckling its mother.',
      cite: 'Dhammapada 284' },
    { text: 'Cut out affection for oneself, like plucking an autumn lotus. Foster only the path to peace, the extinguishment the Holy One taught.',
      cite: 'Dhammapada 285' },
    { text: '“Here I will stay for the rains; here for winter, here the summer”; thus the fool thinks, not realizing the danger.',
      cite: 'Dhammapada 286' },
    { text: 'As a mighty flood sweeps away a sleeping village, death steals away a man who dotes on children and cattle, his mind caught up in them.',
      cite: 'Dhammapada 287' },
    { text: 'Children provide you no shelter, nor does father, nor relatives. When you’re seized by the terminator, there’s no shelter in family.',
      cite: 'Dhammapada 288' },
    { text: 'Knowing the reason for this, astute, and ethically restrained, one would quickly clear the path that leads to extinguishment.',
      cite: 'Dhammapada 289' },
    { text: 'Seeking their own happiness by imposing suffering on others, intimate with enmity, they’re not freed from enmity.',
      cite: 'Dhammapada 291' },
    { text: 'They dump what should be done, and do what should not be done. For the insolent and the negligent, their defilements only grow.',
      cite: 'Dhammapada 292' },
    { text: 'Those that have properly undertaken constant mindfulness of the body, don’t cultivate what should not be done, but always do what should be done. Mindful and aware, their defilements come to an end.',
      cite: 'Dhammapada 293' },
    { text: 'Having slain mother and father, and two aristocratic kings, and having wiped out <j>the kingdom with its tax collector, the brahmin walks on untroubled.',
      cite: 'Dhammapada 294' },
    { text: 'Having slain mother and father, and two prosperous kings, and a tiger as the fifth, the brahmin walks on untroubled.',
      cite: 'Dhammapada 295' },
    { text: 'The disciples of Gotama always wake up refreshed, who day and night constantly recollect the Buddha.',
      cite: 'Dhammapada 296' },
    { text: 'The disciples of Gotama always wake up refreshed, who day and night constantly recollect the teaching.',
      cite: 'Dhammapada 297' },
    { text: 'The disciples of Gotama always wake up refreshed, who day and night constantly recollect the Saṅgha.',
      cite: 'Dhammapada 298' },
    { text: 'The disciples of Gotama always wake up refreshed, who day and night are constantly mindful of the body.',
      cite: 'Dhammapada 299' },
    { text: 'The disciples of Gotama always wake up refreshed, whose minds day and night delight in harmlessness.',
      cite: 'Dhammapada 300' },
    { text: 'The disciples of Gotama always wake up refreshed, whose minds day and night delight in meditation.',
      cite: 'Dhammapada 301' },
    { text: 'One who is faithful, accomplished in ethics, blessed with fame and wealth, is honored in whatever place they frequent.',
      cite: 'Dhammapada 303' },
    { text: 'Sitting alone, sleeping alone, tirelessly wandering alone; one who tames themselves alone would delight within a forest.',
      cite: 'Dhammapada 305' },
    { text: 'Any lax act, any corrupt observance, or suspicious spiritual life, is not very fruitful.',
      cite: 'Dhammapada 312' },
    { text: 'If one is to do what should be done, one should staunchly strive. For the life gone forth when laxly led just stirs up dust all the more.',
      cite: 'Dhammapada 313' },
    { text: 'A bad deed is better left undone, for it will plague you later on. A good deed is better done, one that does not plague you.',
      cite: 'Dhammapada 314' },
    { text: 'Unashamed of what is shameful, ashamed of what is not shameful; beings who uphold wrong view go to a bad place.',
      cite: 'Dhammapada 316' },
    { text: 'Seeing danger where there is none, and blind to the actual danger, beings who uphold wrong view go to a bad place.',
      cite: 'Dhammapada 317' },
    { text: 'Seeing fault where there is none, and blind to the actual fault, beings who uphold wrong view go to a bad place.',
      cite: 'Dhammapada 318' },
    { text: 'Knowing a fault as a fault and the faultless as faultless, beings who uphold right view go to a good place.',
      cite: 'Dhammapada 319' },
    { text: 'Like an elephant struck with arrows in battle, I shall endure abuse, for so many folk are badly behaved.',
      cite: 'Dhammapada 320' },
    { text: 'The well-tamed beast is the one led to the crowd; the tamed elephant’s the one the king mounts; the tamed person who endures abuse is the best of human beings.',
      cite: 'Dhammapada 321' },
    { text: 'Those who have tamed themselves are better than fine tamed mules, thoroughbreds from Sindh, or giant tuskers.',
      cite: 'Dhammapada 322' },
    { text: 'For not on those mounts would you go to the untrodden place, whereas, with the help of one <j>whose self is well tamed, you go there, tamed by the tamed.',
      cite: 'Dhammapada 323' },
    { text: 'The tusker named Dhanapāla is musky in rut, hard to control. Bound, he eats not a morsel, for he misses the elephant forest.',
      cite: 'Dhammapada 324' },
    { text: 'One who gets drowsy from overeating, fond of sleep, rolling round the bed like a great hog stuffed with grain: that dullard returns to the womb again and again.',
      cite: 'Dhammapada 325' },
    { text: 'In the past my mind wandered how it wished, where it liked, as it pleased. Now I’ll carefully guide it, as a trainer with a hook guides a rutting elephant.',
      cite: 'Dhammapada 326' },
    { text: 'If you find no alert companion, no attentive friend to live happily together, then, like a king who flees his conquered realm, wander alone like a tusker in the wilds.',
      cite: 'Dhammapada 329' },
    { text: 'It’s better to wander alone, there’s no fellowship with fools. Wander alone and do no wrong, at ease like a tusker in the wilds.',
      cite: 'Dhammapada 330' },
    { text: 'In this world it’s a blessing to serve one’s mother and one’s father. And it’s a blessing also to serve ascetics and brahmins.',
      cite: 'Dhammapada 332' },
    { text: 'It’s a blessing to keep precepts until you grow old; a blessing to be grounded in faith; the getting of wisdom’s a blessing; and it’s a blessing to avoid doing wrong.',
      cite: 'Dhammapada 333' },
    { text: 'When a man lives heedlessly, craving grows in them like a camel’s foot creeper. They jump from one thing to the next, like a langur greedy for fruit in a forest grove.',
      cite: 'Dhammapada 334' },
    { text: 'Whoever is beaten by this wretched craving, this attachment to the world, their sorrow grows, like grass in the rain.',
      cite: 'Dhammapada 335' },
    { text: 'But whoever prevails over this wretched craving, so hard to get over in the world, their sorrows fall from them, like a drop from a lotus-leaf.',
      cite: 'Dhammapada 336' },
    { text: 'A tree grows back even when cut down, so long as its roots are strong and undamaged; suffering springs up again and again, so long as the tendency to craving is not pulled out.',
      cite: 'Dhammapada 338' },
    { text: 'A person of low views in whom the thirty-six streams that flow to pleasure are mighty, is swept away by lustful thoughts.',
      cite: 'Dhammapada 339' },
    { text: 'The streams flow everywhere; a weed springs up and remains. Seeing this weed that has been born, cut the root with wisdom.',
      cite: 'Dhammapada 340' },
    { text: 'A personage’s joys flow from senses and cravings. Seekers of happiness, bent on pleasure, continue to be reborn and grow old.',
      cite: 'Dhammapada 341' },
    { text: 'People governed by thirst, crawl about like a trapped rabbit. Bound and fettered, for a long time they return to pain time and again.',
      cite: 'Dhammapada 342' },
    { text: 'People governed by thirst, crawl about like a trapped rabbit. That’s why one who longs for dispassion should dispel thirst.',
      cite: 'Dhammapada 343' },
    { text: 'Unsnarled, they set out for the jungle, then they run right back to the jungle they left behind. Just look at this individual! Freed, they run to bondage.',
      cite: 'Dhammapada 344' },
    { text: 'The attentive say that shackle is not strong that’s made of iron, wood, or knots. But obsession with jeweled earrings, concern for your partners and children:',
      cite: 'Dhammapada 345' },
    { text: 'this, say the attentive, is a strong shackle dragging the indulgent down, hard to escape. Having cut this one too they go forth, unconcerned, having given up sensual pleasures.',
      cite: 'Dhammapada 346' },
    { text: 'Besotted by lust they fall into the stream, like a spider caught in the web she wove. The attentive proceed, having cut this one too, unconcerned, having given up all suffering.',
      cite: 'Dhammapada 347' },
    { text: 'For a personage churned by thoughts, very lustful, focusing on beauty, their craving grows and grows, tying them with a stout bond.',
      cite: 'Dhammapada 349' },
    { text: 'But one who loves to calm their thoughts, developing perception of ugliness, ever mindful, will surely eliminate that craving, cutting off the bonds of Māra.',
      cite: 'Dhammapada 350' },
    { text: 'The gift of the teaching surmounts all other gifts; the taste of the teaching surmounts all other tastes; the joy of the teaching surmounts all other joys; the ending of craving surmounts all suffering.',
      cite: 'Dhammapada 354' },
    { text: 'Riches ruin a simpleton, but not a seeker of the far shore. From craving for wealth, a simpleton ruins themselves and others.',
      cite: 'Dhammapada 355' },
    { text: 'Weeds are the bane of crops, but greed is these folk’s bane. That’s why a gift to one rid of greed is so very fruitful.',
      cite: 'Dhammapada 356' },
    { text: 'Weeds are the bane of crops, but hate is these folk’s bane. That’s why a gift to one rid of hate is so very fruitful.',
      cite: 'Dhammapada 357' },
    { text: 'Weeds are the bane of crops, but delusion is these folk’s bane. That’s why a gift to one rid of delusion is so very fruitful.',
      cite: 'Dhammapada 358' },
    { text: 'Weeds are the bane of crops, but desire is these folk’s bane. That’s why a gift to one rid of desire is so very fruitful.',
      cite: 'Dhammapada 359' },
    { text: 'Restraint of the eye is good; good is restraint of the ear; restraint of the nose is good; good is restraint of the tongue.',
      cite: 'Dhammapada 360' },
    { text: 'Restraint of the body is good; good is restraint of speech; restraint of mind is good; everywhere, restraint is good. The mendicant restrained everywhere is released from all suffering.',
      cite: 'Dhammapada 361' },
    { text: 'One restrained in hand and foot, and in speech, the supreme restraint; happy inside, serene, solitary, content, I call a mendicant.',
      cite: 'Dhammapada 362' },
    { text: 'When a mendicant of restrained mouth, thoughtful in counsel, not restless, explains the text and its meaning, their words are sweet.',
      cite: 'Dhammapada 363' },
    { text: 'Delighting in the teaching, enjoying the teaching, contemplating the teaching, a mendicant who recollects the teaching doesn’t fall away from the true teaching.',
      cite: 'Dhammapada 364' },
    { text: 'A well-off mendicant ought not look down on others, nor should they be envious. A mendicant who envies others does not achieve immersion.',
      cite: 'Dhammapada 365' },
    { text: 'If a mendicant is poor in offerings, the well-to-do ought not look down on them. For the gods indeed praise them, who are tireless and pure of livelihood.',
      cite: 'Dhammapada 366' },
    { text: 'One who has no sense of ownership in the whole realm of name and form, who does not grieve for that which is not, is said to be a mendicant.',
      cite: 'Dhammapada 367' },
    { text: 'A mendicant who meditates on love, devoted to the Buddha’s teaching, would realize the peaceful state, the blissful stilling of conditions.',
      cite: 'Dhammapada 368' },
    { text: 'Bail out this boat, mendicant! When bailed out it will float lightly. Having cut off desire and hate, you shall reach extinguishment.',
      cite: 'Dhammapada 369' },
    { text: 'Five to cut, five to drop, and five more to develop. When a mendicant slips five chains they’re said to have crossed the flood.',
      cite: 'Dhammapada 370' },
    { text: 'A mendicant who enters an empty hut with mind at peace finds a superhuman delight as they rightly discern the Dhamma.',
      cite: 'Dhammapada 373' },
    { text: 'This is the very start of the path for a wise mendicant here: guarding the senses, contentment, and restraint in the monastic code.',
      cite: 'Dhammapada 375' },
    { text: 'Mix with spiritual friends, who are tireless and pure of livelihood. Share what you have with others, being skillful in your conduct. And when you’re full of joy, you’ll make an end to suffering.',
      cite: 'Dhammapada 376' },
    { text: 'As a jasmine sheds its withered flowers, O mendicants, shed greed and hate.',
      cite: 'Dhammapada 377' },
    { text: 'Calm in body, calm in speech, peaceful and serene; a mendicant who’s spat out the world’s bait is said to be one at peace.',
      cite: 'Dhammapada 378' },
    { text: 'Urge yourself on, reflect on yourself. A mendicant self-controlled and mindful will always dwell in happiness.',
      cite: 'Dhammapada 379' },
    { text: 'Self is indeed the lord of self, for who else would be one’s lord? Self is indeed the home of self, so restrain yourself, as a merchant his thoroughbred steed.',
      cite: 'Dhammapada 380' },
    { text: 'A monk full of joy trusting in the Buddha’s teaching, would realize the peaceful state, the blissful stilling of conditions.',
      cite: 'Dhammapada 381' },
    { text: 'A young mendicant devoted to the Buddha’s teaching, shines upon this world, like the moon freed from clouds.',
      cite: 'Dhammapada 382' },
    { text: 'Cut the stream, striving! Cast aside sensual pleasures, brahmin. Knowing the ending of conditions, know the uncreated, brahmin.',
      cite: 'Dhammapada 383' },
    { text: 'When a brahmin has gone beyond dualistic phenomena, then they consciously make an end of all fetters.',
      cite: 'Dhammapada 384' },
    { text: 'One for whom there is no crossing over or crossing back, or crossing over and back; stress-free, detached, that’s who I declare a brahmin.',
      cite: 'Dhammapada 385' },
    { text: 'Absorbed, rid of hopes, their task completed, without defilements, arrived at the highest goal: that’s who I declare a brahmin.',
      cite: 'Dhammapada 386' },
    { text: 'A brahmin’s so-called <j>since they’ve banished evil, an ascetic’s so-called <j>since they live a serene life. One who has renounced all stains is said to be a “renunciant”.',
      cite: 'Dhammapada 388' },
    { text: 'One should never strike a brahmin, nor should a brahmin retaliate. Woe to the one who hurts a brahmin, and woe for the one who retaliates.',
      cite: 'Dhammapada 389' },
    { text: 'Nothing is better for a brahmin than to hold their mind back from attachment. From wherever a cruel wish recoils, right there suffering subsides.',
      cite: 'Dhammapada 390' },
    { text: 'Who does nothing wrong by body, speech or mind, restrained in these three respects, that’s who I declare a brahmin.',
      cite: 'Dhammapada 391' },
    { text: 'You should graciously honor the one from whom you learn the Dhamma taught by the awakened Buddha, as a brahmin honors the sacred flame.',
      cite: 'Dhammapada 392' },
    { text: 'Not by matted hair or family, or birth is one a brahmin. Those who are truthful and principled: they are pure, they are brahmins.',
      cite: 'Dhammapada 393' },
    { text: 'Why the matted hair, you simpleton, and why the skin of deer? The tangle is inside you, yet you polish up your outsides.',
      cite: 'Dhammapada 394' },
    { text: 'I don’t call someone a brahmin after the mother’s womb they’re born from. If they still have attachments, they’re just someone who says “worthy”. Having nothing, taking nothing: that’s who I declare a brahmin.',
      cite: 'Dhammapada 396' },
    { text: 'Having cut off all fetters they have no anxiety. They’ve slipped their chains and are detached: that’s who I declare a brahmin.',
      cite: 'Dhammapada 397' },
    { text: 'They’ve cut the strap and harness, the halter and bridle too, with cross-bar lifted, they’re awakened: that’s who I declare a brahmin.',
      cite: 'Dhammapada 398' },
    { text: 'Abuse, killing, caging: they endure these without anger. Patience is their powerful army: that’s who I declare a brahmin.',
      cite: 'Dhammapada 399' },
    { text: 'Not irritable or pretentious, dutiful in precepts and observances, tamed, bearing their final body: that’s who I declare a brahmin.',
      cite: 'Dhammapada 400' },
    { text: 'Like water from a lotus leaf, like a mustard seed off the point of a pin, sensual pleasures slip off them: that’s who I declare a brahmin.',
      cite: 'Dhammapada 401' },
    { text: 'They understand for themselves the end of suffering in this life; with burden put down, detached: that’s who I declare a brahmin.',
      cite: 'Dhammapada 402' },
    { text: 'Deep in wisdom, intelligent, expert in the path and what is not the path; arrived at the highest goal: that’s who I declare a brahmin.',
      cite: 'Dhammapada 403' },
    { text: 'Mixing with neither householders nor the homeless; a migrant with no bastion, few in wishes: that’s who I declare a brahmin.',
      cite: 'Dhammapada 404' },
    { text: 'They’ve laid aside violence against creatures firm and frail; not killing or making others kill: that’s who I declare a brahmin.',
      cite: 'Dhammapada 405' },
    { text: 'Not fighting among those who fight, quenched among those who have taken up arms, not grasping among those who grasp: that’s who I declare a brahmin.',
      cite: 'Dhammapada 406' },
    { text: 'They’ve discarded greed and hate, along with conceit and contempt, like a mustard seed off the point of a pin: that’s who I declare a brahmin.',
      cite: 'Dhammapada 407' },
    { text: 'The words they utter are polished, informative, and true, and don’t offend anyone: that’s who I declare a brahmin.',
      cite: 'Dhammapada 408' },
    { text: 'They don’t steal anything in the world, long or short, tiny or huge, beautiful or ugly: that’s who I declare a brahmin.',
      cite: 'Dhammapada 409' },
    { text: 'They have no hope in this world or the next; with no need for hope, detached: that’s who I declare a brahmin.',
      cite: 'Dhammapada 410' },
    { text: 'They have no clinging, knowledge has freed them of indecision, they’ve arrived at the objective, freedom from death: that’s who I declare a brahmin.',
      cite: 'Dhammapada 411' },
    { text: 'They’ve escaped the chain of both good and bad deeds; sorrowless, stainless, pure: that’s who I declare a brahmin.',
      cite: 'Dhammapada 412' },
    { text: 'Pure as the spotless moon, clear and unclouded, they’ve ended relish for rebirth: that’s who I declare a brahmin.',
      cite: 'Dhammapada 413' },
    { text: 'They’ve got past this grueling swamp of delusion, transmigration. Meditating in stillness, free of indecision, they have crossed over to the far shore. They’re quenched by not grasping: that’s who I declare a brahmin.',
      cite: 'Dhammapada 414' },
    { text: 'They’ve given up sensual pleasures, and have gone forth from lay life; they’ve ended rebirth in the sensual realm: that’s who I declare a brahmin.',
      cite: 'Dhammapada 415' },
    { text: 'They’ve thrown off the human yoke, and slipped out of the heavenly yoke; unyoked from all yokes: that’s who I declare a brahmin.',
      cite: 'Dhammapada 417' },
    { text: 'Giving up desire and discontent, they’re cooled and free of attachments; a hero, master of the whole world: that’s who I declare a brahmin.',
      cite: 'Dhammapada 418' },
    { text: 'They know the passing away and rebirth of all beings; unattached, holy, awakened: that’s who I declare a brahmin.',
      cite: 'Dhammapada 419' },
    { text: 'Gods, centaurs, and humans don’t know their destiny; the perfected ones with defilements ended: that’s who I declare a brahmin.',
      cite: 'Dhammapada 420' },
    { text: 'They have nothing before or after, or even in between. Having nothing, taking nothing: that’s who I declare a brahmin.',
      cite: 'Dhammapada 421' },
    { text: 'Captain of the herd, excellent hero, great seer and victor; unstirred, washed, awakened: that’s who I declare a brahmin.',
      cite: 'Dhammapada 422' }
  ];

  var $ = function (sel) { return document.querySelector(sel); };
  var reduced = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------------
     1. The verse
     ------------------------------------------------------------------ */

  var quoteEl = $('.b-quote');
  var citeEl = $('.b-cite');
  var lastIndex = -1;

  function pick() {
    if (QUOTES.length < 2) return 0;
    var i = lastIndex;
    // Never the same verse twice running — on a page someone may sit with for
    // a while, a repeat reads as the page being broken.
    while (i === lastIndex) i = Math.floor(Math.random() * QUOTES.length);
    lastIndex = i;
    return i;
  }

  function render(index) {
    var q = QUOTES[index];
    quoteEl.textContent = q.text;
    citeEl.textContent = q.cite;
  }

  function swap() {
    if (!quoteEl || !citeEl) return;
    if (reduced) { render(pick()); return; }
    quoteEl.classList.add('b-fading');
    citeEl.classList.add('b-fading');
    window.setTimeout(function () {
      render(pick());
      quoteEl.classList.remove('b-fading');
      citeEl.classList.remove('b-fading');
    }, 700);   // matches the transition in buddha.css
  }

  /* Tapping him is the main way to change the verse; the button below is the
     same action spelled out for anyone who does not think to try the picture. */
  var figure = $('.b-figure');
  var sparkLayer = $('.b-sparkles');

  function sparkle() {
    if (reduced || !sparkLayer) return;
    var NS = 'http://www.w3.org/2000/svg';
    var made = [];
    for (var i = 0; i < 14; i++) {
      var a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      var dist = 130 + Math.random() * 90;
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '200');
      c.setAttribute('cy', '190');
      c.setAttribute('r', (2 + Math.random() * 3.5).toFixed(1));
      c.setAttribute('fill', i % 3 ? '#fff2cf' : '#ffd28a');
      c.style.transition = 'transform 900ms cubic-bezier(0.2,0.7,0.3,1), opacity 900ms ease-out';
      sparkLayer.appendChild(c);
      made.push([c, Math.cos(a) * dist, Math.sin(a) * dist]);
    }
    // One frame later, so the browser has a starting position to animate from.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        for (var j = 0; j < made.length; j++) {
          made[j][0].style.transform = 'translate(' + made[j][1].toFixed(0) + 'px,' + made[j][2].toFixed(0) + 'px)';
          made[j][0].style.opacity = '0';
        }
      });
    });
    window.setTimeout(function () {
      while (sparkLayer.firstChild) sparkLayer.removeChild(sparkLayer.firstChild);
    }, 1000);
  }

  var tapping = false;
  function tap() {
    if (tapping) return;       // let one bounce finish before starting another
    tapping = true;
    if (figure && !reduced) {
      figure.classList.add('is-tapped');
      window.setTimeout(function () { figure.classList.remove('is-tapped'); }, 900);
    }
    sparkle();
    swap();
    window.setTimeout(function () { tapping = false; }, reduced ? 0 : 900);
  }

  if (quoteEl && citeEl) {
    render(pick());
    if (figure) figure.addEventListener('click', tap);
    var another = $('.b-another');
    if (another) another.addEventListener('click', tap);
  }

  /* ---------------------------------------------------------------------
     2. The breath
     ---------------------------------------------------------------------
     The ring is animated in CSS on a 10s cycle: 4s expanding, 6s settling.
     This only writes the words, off the same clock, so the two cannot drift.
     A longer out-breath than in-breath is the part that does the work.
     ------------------------------------------------------------------ */

  var labelEl = $('.b-breath-label');
  if (labelEl) {
    if (reduced) {
      labelEl.textContent = 'Breathe gently';
    } else {
      var CYCLE = 10000;
      var IN = 4000;
      var started = Date.now();
      var shown = '';

      window.setInterval(function () {
        var t = (Date.now() - started) % CYCLE;
        var want = t < IN ? 'Breathe in' : 'Breathe out';
        if (want !== shown) {
          shown = want;
          labelEl.style.opacity = '0';
          window.setTimeout(function () {
            labelEl.textContent = want;
            labelEl.style.opacity = '1';
          }, 450);
        }
      }, 200);
    }
  }

  /* ---------------------------------------------------------------------
     3. Leaves and light
     ---------------------------------------------------------------------
     Built here rather than written into the markup so no two visits look
     quite the same, and so reduced-motion simply never creates them. The
     delays are negative on purpose: the scene should already be in motion
     when it appears, not fill up slowly from an empty sky.
     ------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------
     0. How tall the hero may be
     ---------------------------------------------------------------------
     The shared header is injected after this script runs and its height
     changes with the viewport, so it is measured rather than assumed.
     ------------------------------------------------------------------ */

  function measureHeader() {
    // The scene's own distance from the top of the document, not the header's
    // height — that also picks up whatever margin sits between the two, which
    // measuring the header alone missed by 32px.
    var scene = document.querySelector('.b-scene');
    if (!scene) return;
    var top = Math.round(scene.getBoundingClientRect().top + (window.pageYOffset || 0));
    document.documentElement.style.setProperty('--b-header', Math.max(0, top) + 'px');
  }

  measureHeader();
  window.addEventListener('resize', measureHeader);
  // include-partials.js replaces the static header with the canonical one, so
  // re-measure once that has had a chance to land.
  window.setTimeout(measureHeader, 400);
  window.setTimeout(measureHeader, 1500);
  if (window.ResizeObserver) {
    var hdr = document.querySelector('header.site-header');
    if (hdr && hdr.parentNode) {
      new ResizeObserver(measureHeader).observe(hdr.parentNode);
    }
  }

  /* ---------------------------------------------------------------------
     4. Filling the screen
     ---------------------------------------------------------------------
     Only the scene goes fullscreen, so the header and the section below are
     simply absent rather than hidden. The label is kept in step with the
     actual state via the fullscreenchange event, because the user can also
     leave with Escape and the button must not then lie about what it does.
     ------------------------------------------------------------------ */

  var fsBtn = $('.b-fs');
  var scene = $('.b-scene');

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  if (fsBtn && scene) {
    if (!(scene.requestFullscreen || scene.webkitRequestFullscreen)) {
      fsBtn.hidden = true;              // iPhone Safari has no element fullscreen
    } else {
      fsBtn.addEventListener('click', function () {
        if (fsElement()) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          (scene.requestFullscreen || scene.webkitRequestFullscreen).call(scene);
        }
      });

      var syncFs = function () {
        var on = !!fsElement();
        fsBtn.setAttribute('aria-label', on ? 'Leave full screen' : 'Fill the screen');
        fsBtn.setAttribute('title', on ? 'Leave full screen' : 'Fill the screen');
        // In fullscreen there is no header above the scene to subtract.
        if (on) document.documentElement.style.setProperty('--b-header', '0px');
        else measureHeader();
      };
      document.addEventListener('fullscreenchange', syncFs);
      document.addEventListener('webkitfullscreenchange', syncFs);
    }
  }

  var stage = $('.b-scene');
  if (stage && !reduced) {
    var LEAF = '<svg viewBox="0 0 24 30" aria-hidden="true" focusable="false">' +
      '<path d="M12 0C6 7 1 13 1 19a11 11 0 0 0 22 0c0-6-5-12-11-19z" fill="currentColor" opacity="0.75"/>' +
      '<path d="M12 3v25M12 12l6 4M12 12L6 16M12 20l5 3M12 20l-5 3" stroke="rgba(20,32,20,0.35)" ' +
      'stroke-width="0.9" fill="none" stroke-linecap="round"/></svg>';

    var rand = function (lo, hi) { return lo + Math.random() * (hi - lo); };
    var frag = document.createDocumentFragment();
    var i;

    for (i = 0; i < 9; i++) {
      var leaf = document.createElement('span');
      leaf.className = 'b-leaf';
      leaf.setAttribute('aria-hidden', 'true');
      leaf.style.setProperty('--x', rand(4, 92).toFixed(1) + '%');
      leaf.style.setProperty('--size', rand(16, 32).toFixed(0) + 'px');
      leaf.style.setProperty('--dur', rand(20, 38).toFixed(1) + 's');
      leaf.style.setProperty('--delay', (-rand(0, 34)).toFixed(1) + 's');
      leaf.style.color = i % 3 === 0 ? '#cfe0b0' : '#b8cf9a';
      leaf.innerHTML = LEAF;
      frag.appendChild(leaf);
    }

    for (i = 0; i < 14; i++) {
      var mote = document.createElement('span');
      mote.className = 'b-mote';
      mote.setAttribute('aria-hidden', 'true');
      mote.style.setProperty('--x', rand(6, 94).toFixed(1) + '%');
      mote.style.setProperty('--size', rand(2, 5).toFixed(1) + 'px');
      mote.style.setProperty('--dur', rand(14, 30).toFixed(1) + 's');
      mote.style.setProperty('--delay', (-rand(0, 26)).toFixed(1) + 's');
      frag.appendChild(mote);
    }

    stage.appendChild(frag);
  }
}());
