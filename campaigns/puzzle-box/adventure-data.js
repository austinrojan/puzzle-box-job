export const ADVENTURE_DATA = {
  meta: {
    title: 'The Puzzle-Box Job',
    system: 'D&D 5e',
    level: 6,
    players: 5,
    runtime: '2-3 hours',
    setting: 'Waterdeep \u2014 Dock District (base) / Sea District (heist)'
  },
  acts: [
    {
      id: 'act-1', number: 1, title: 'The Job Offer', duration: '~15 min',
      sections: [
        {
          id: 'act-1-setting', title: 'Setting the Scene',
          blocks: [
            {
              id: 'a1-read-1', type: 'read-aloud',
              vtt: { scene: 'S01', mode: 'theater' },
              text: 'The Rusty Anchor sits at the edge of the Dock District where the salt air meets the stink of low tide. You\u2019ve been here before \u2014 it\u2019s the kind of place where nobody asks questions and everybody minds their own business. Tonight, a corner booth has been reserved. A single candle burns on the table. The man sitting there watches you approach with the calm patience of someone who has never been surprised in his life.\n\n\u201CSit,\u201D he says. \u201CWe have business.\u201D'
            }
          ]
        },
        {
          id: 'act-1-briefing', title: "Locke\u2019s Briefing",
          blocks: [
            {
              id: 'a1-read-2', type: 'read-aloud',
              vtt: { scene: 'S02' },
              text: 'Locke slides a folded piece of parchment across the table \u2014 a rough sketch of a manor estate \u2014 and taps it once with a gloved finger.\n\n\u201CLord Aldric Veymar. Sea District. You know the type \u2014 old money, high walls, the kind of man who collects things he doesn\u2019t understand. His estate is a three-story manor behind stone walls and iron gates. Tonight, he\u2019s hosting a gala. Half the nobility of Waterdeep will be there, which means the place will be full of people, noise, and distractions. Perfect cover.\u201D\n\nHe leans back, fingers interlaced.\n\n\u201COn the third floor, in his private study, there is a puzzle box. Small \u2014 fits in the palm of your hand. That is your objective. Get inside, take the box, get out. Simple work for people of your talents.\u201D\n\nHe reaches into his coat and sets a leather pouch on the table. It clinks heavily.\n\n\u201CFive hundred gold pieces each. Half now, half when you deliver the box to me before dawn. Do you find these terms, agreeable?\u201D'
            },
            {
              id: 'a1-check-negotiate', type: 'skill-check',
              check: 'Persuasion', dc: 18,
              details: "Negotiate up to 750 gp each. Martin's +5 and Jean's +6 make this achievable together via Help action. Bardic Inspiration makes it very likely."
            },
            {
              id: 'a1-read-3', type: 'read-aloud',
              text: 'His expression shifts. The smile stays, but the warmth drains from it.\n\n\u201COne condition. One rule. Non-negotiable.\u201D\n\nHe leans forward.\n\n\u201CDo not open the box. I cannot stress this enough. You will not be paid if the seal is broken. You will not be forgiven. Deliver it sealed, and we part as friends. Break it open, and\u2026 well, let\u2019s just say I can be less friendly.\u201D'
            },
            {
              id: 'a1-dm-religion', type: 'dm-note',
              title: "L\u00F3m\u00EB\u2019s Religion Check (Unprompted)",
              text: "**[Pause here.]** Give L\u00F3m\u00EB an **unprompted Religion DC 12 check** (she has +6, needs 6+, very likely to succeed). On success, read to her privately:"
            },
            {
              id: 'a1-read-religion', type: 'read-aloud',
              text: 'Something about how Locke speaks about the box \u2014 the gravity, the specificity \u2014 reminds you of the warnings in Kelemvor\u2019s scripture about sealed artifacts. Containers of souls. Instruments of final death. You\u2019ve read about things like this. They\u2019re not meant to be moved.'
            },
            {
              id: 'a1-read-4', type: 'read-aloud',
              text: '\u201CDo we have an agreement?\u201D'
            }
          ]
        },
        {
          id: 'act-1-foreshadowing', title: 'Foreshadowing (Subtle)',
          blocks: [
            {
              id: 'a1-fore-intro', type: 'narrative',
              text: "Plant these details naturally during the conversation \u2014 don\u2019t force all of them:"
            },
            {
              id: 'a1-cond-five', type: 'conditional',
              condition: 'If players ask why he needs exactly five people',
              outcome: 'Locke tilts his head, as if the question amuses him. \u201CFive is the right number for a job like this. Fewer draws suspicion. More invites chaos. Five is\u2026 elegant.\u201D\n\n*(The real reason: five sacrifices.)*'
            },
            {
              id: 'a1-cond-gloves', type: 'conditional',
              condition: "Locke\u2019s gloves \u2014 if someone comments or asks",
              outcome: '\u201CAn old habit. I have\u2026 sensitive hands.\u201D\n\n*(Rakshasa hands are inverted \u2014 palms where the backs should be.)*'
            },
            {
              id: 'a1-cond-insight', type: 'conditional',
              condition: 'If anyone rolls Insight (DC 20)',
              outcome: "*(L\u00F3m\u00EB has the best shot at +6 \u2014 needs 14. Martin gets +4 from Jack of All Trades \u2014 needs 16. Jean has -1; he\u2019ll notice nothing.)*\n\nSomething about Locke feels rehearsed. His mannerisms are perfect \u2014 too perfect. He moves like a man, speaks like a man, but there\u2019s a quality to it, like watching someone who has studied what a person is supposed to look like and is performing the role flawlessly. Almost."
            },
            {
              id: 'a1-cond-food', type: 'conditional',
              condition: 'If anyone offers Locke food or drink',
              outcome: 'He raises a gloved hand. \u201CNo, thank you. I\u2019ve already eaten.\u201D His smile doesn\u2019t waver, but for a moment, something flickers behind his eyes \u2014 a private joke.'
            }
          ]
        },
        {
          id: 'act-1-decline', title: 'If Players Decline',
          blocks: [
            {
              id: 'a1-read-decline', type: 'read-aloud',
              text: 'Locke\u2019s expression doesn\u2019t change. He reaches for the leather pouch and begins pulling it back across the table.\n\n\u201CA shame. Truly. I had hoped your reputation was earned.\u201D He pauses, then adds, almost casually: \u201CI suppose I\u2019ll send word to the Jackdaws. Ren\u2019s crew. You know them, I\u2019m sure \u2014 loud, sloppy, but willing. They\u2019ve been asking about this job for a week.\u201D\n\nHe stands, straightening his coat.\n\n\u201COf course, if Ren\u2019s people get to the box first, any future opportunity I might have brought your way goes with them. But that\u2019s your choice.\u201D'
            },
            {
              id: 'a1-dm-decline', type: 'dm-note',
              title: 'If They Still Refuse',
              text: "This should trigger competitive pride. If they still refuse, the one-shot pivots to them racing the Jackdaws for the box (improvise)."
            }
          ]
        },
        {
          id: 'act-1-transition', title: 'Transition',
          blocks: [
            {
              id: 'a1-read-transition', type: 'read-aloud',
              vtt: { titleCard: 2 },
              text: 'Locke pushes the sketch of the estate toward you and stands, pulling on his coat.\n\n\u201CThe gala begins at sundown. That gives you a few hours to prepare \u2014 scout the grounds, talk to the right people, do whatever it is you do. I don\u2019t care how you get in. I care that the box is in my hands before dawn.\u201D\n\nHe sets a second, smaller piece of parchment on the table \u2014 an address in the Dock District.\n\n\u201CWhen you have it, come here. I\u2019ll be waiting.\u201D\n\nHe turns to leave, then pauses.\n\n\u201CAnd remember \u2014 do not open the box.\u201D\n\nHe walks out without looking back.'
            }
          ]
        }
      ]
    },
    {
  id: 'act-2', number: 2, title: 'Gathering Intel & Planning', duration: '~20-30 min',
  sections: [
    {
      id: 'act-2-after-locke', title: 'After Locke Leaves',
      blocks: [
        {
          id: 'a2-read-1', type: 'read-aloud',
          vtt: { scene: 'S03', mode: 'theater' },
          text: 'The door to the Rusty Anchor swings shut behind Locke. The noise of the tavern rushes back in \u2014 the clink of mugs, the murmur of drunken conversation, the creak of floorboards. On the table in front of you: a rough sketch of an estate, a Dock District address on a scrap of parchment, and a pouch of gold that\u2019s heavier than it has any right to be.\n\nOutside, the afternoon sun is already starting its descent. You have maybe three, four hours before sundown. Before the gala. Before this thing becomes real.\n\nSo \u2014 what\u2019s the plan?'
        },
        {
          id: 'a2-dm-pacing', type: 'dm-note',
          title: 'Player Agency',
          text: 'Let the players talk. Give them a beat. If they jump into planning immediately \u2014 great, follow their lead. But if they hesitate or look to you for direction, use the prompts below.'
        }
      ]
    },
    {
      id: 'act-2-what-we-know', title: 'If Players Ask: \u201CWhat Do We Already Know?\u201D',
      blocks: [
        {
          id: 'a2-narrative-know', type: 'narrative',
          text: 'This is what their characters would reasonably know as experienced locals in the Dock District:'
        },
        {
          id: 'a2-read-know', type: 'read-aloud',
          text: 'Here\u2019s what you know. Lord Aldric Veymar is old Waterdeep money \u2014 Sea District nobility, the kind of family that\u2019s had a seat at the table since before your grandparents were born. His estate is one of the bigger ones on the ward\u2019s north side \u2014 three stories, stone walls, iron fence, private grounds. You\u2019ve seen it from the outside. Everyone has. It\u2019s not the kind of place you just walk into.\n\nVeymar himself is known as a collector \u2014 rare books, arcane artifacts, things pulled from ruins and shipwrecks. He\u2019s eccentric, private, and paranoid. Not well-liked among the other nobles, but too rich to ignore.\n\nTonight, he\u2019s hosting one of his galas. These are invitation-only affairs \u2014 wealthy merchants, minor nobility, the occasional visiting dignitary. Heavy security. But also a lot of people, a lot of noise, and a lot of distractions.\n\nYou don\u2019t know the layout inside the mansion. You don\u2019t know what security looks like beyond the front gate. You don\u2019t know where the study is or what\u2019s protecting the box. But you know this district, you know these streets, and you have a few hours to figure the rest out.'
        }
      ]
    },
    {
      id: 'act-2-what-can-we-do', title: 'If Players Ask: \u201CWhat Can We Do?\u201D or Seem Stuck',
      blocks: [
        {
          id: 'a2-dm-stuck', type: 'dm-note',
          title: 'Framing',
          text: 'Don\u2019t read a list. Instead, frame it as their characters thinking through their options:'
        },
        {
          id: 'a2-read-options', type: 'read-aloud',
          text: 'Alright \u2014 you\u2019ve got a few hours and a target you know almost nothing about. Think about what you\u2019d normally do before a job like this.\n\nYou could head over to the Sea District and scope the place out yourself \u2014 see the walls, the gates, the guard patrols. Get eyes on it before tonight.\n\nVeymar\u2019s got household staff \u2014 servants, kitchen workers, groundskeepers. People like that are usually underpaid and easy to talk to, if you know how to ask.\n\nA man like Veymar has rivals. Other nobles who\u2019d love to see him embarrassed. The right conversation at the right tea house could turn up useful dirt.\n\nThis is the Dock District. Somebody here knows something. Knuckles down at the market always has his ear to the ground \u2014 and he usually has useful things for sale, too.\n\nSome of Veymar\u2019s estate guards drink at the taverns around here when they\u2019re off duty. A few rounds of ale can loosen a lot of tongues.\n\nOr there\u2019s the grounds crew \u2014 gardeners, stable hands. People who work the outside of the estate and know every path, every door, every shortcut.'
        },
        {
          id: 'a2-dm-offer', type: 'dm-note',
          title: 'How Many to Offer',
          text: 'You don\u2019t have to offer all six. Read the room \u2014 offer 2\u20133 that match your players\u2019 style. If nobody bites, just pick the one you think will be most fun and have an NPC approach *them* (e.g., Pip bumps into them on the street, looking nervous).'
        },
        {
          id: 'a2-dm-oda', type: 'dm-tip',
          title: 'Oda Wild Shape Scouting',
          text: '**Oda will almost certainly want to Wild Shape scout** \u2014 see note under Option 1. If she does, count it as one of their 3 intel attempts and steer the remaining 2 toward social options (Pip, Thorne, Knuckles, guards) that Wild Shape can\u2019t replace.'
        }
      ]
    },
    {
      id: 'act-2-pacing', title: 'Pacing Rule',
      blocks: [
        {
          id: 'a2-narrative-pacing', type: 'narrative',
          text: 'Players can pursue up to **3 intel attempts** before the gala begins. After 3 attempts (or whenever the energy starts to flag), trigger the **Transition to Act 3** at the end of this section.'
        }
      ]
    },
    {
      id: 'act-2-intel-1', title: 'Intel 1: Scouting the Mansion',
      blocks: [
        {
          id: 'a2-dm-scout-who', type: 'dm-tip',
          title: 'Best Sent',
          text: 'Oda via Wild Shape, or the Rogue with Stealth expertise.'
        },
        {
          id: 'a2-dm-wildshape', type: 'dm-note',
          title: 'If Oda Wild Shapes to Scout',
          text: 'Spider, rat, cat, or bird \u2014 CR 2, lasts 3 hours. She can learn guard rotation patterns, the servant\u2019s entrance, layout of the grounds, the conservatory/hedge maze, and exterior entry points. She **can\u2019t** learn insider knowledge (Pip\u2019s dumbwaiter intel), political gossip (Thorne\u2019s ward warning), or street-level intel (Knuckles\u2019 items for sale) \u2014 Wild Shape provides eyes, not conversations.\n\n**Countermeasures:** the Mastiffs react to wild-shaped animals with hostility (keen smell, Perception +3); the arcane ward on the study door pulses when a shapechanger approaches within 10 ft (warning tingle in beast form); estate staff kill vermin on sight; bird form gives an aerial view but can\u2019t enter the building. If she succeeds, reward the creativity \u2014 grant the scouting intel for free and move on to social options.'
        },
        {
          id: 'a2-read-scout-1', type: 'read-aloud',
          vtt: { scene: 'S04' },
          text: 'The walk from the Dock District to the Sea District takes about twenty minutes, and the difference hits you before you even cross the ward line. The streets get wider. The buildings get taller. The smell of fish and tar gives way to clean stone and flowering window boxes.\n\nThe Veymar estate sits on the north end of the ward \u2014 you spot the pale stone walls and iron fence from two blocks away. Even from a distance, you can see activity: servants carrying crates of wine, a florist\u2019s cart unloading arrangements, the first carriages beginning to arrive for tonight\u2019s gala. Two guards in polished half-plate stand at the main gate, watching the street with professional disinterest.\n\nThere\u2019s a low stone wall across the street with a good sightline. If you\u2019re careful, you could watch the place for a while without being noticed.'
        },
        {
          id: 'a2-check-scout-stealth', type: 'skill-check',
          check: 'Stealth', dc: 14,
          details: 'To observe without being seen.'
        },
        {
          id: 'a2-check-scout-percep', type: 'skill-check',
          check: 'Perception', dc: 12,
          details: 'To notice useful details.'
        },
        {
          id: 'a2-cond-scout-partial', type: 'conditional',
          condition: 'If Stealth passes but Perception fails',
          outcome: '*You find a spot across the street \u2014 a low stone wall with a decent sightline \u2014 and settle in. For the better part of an hour, you watch. Servants come and go. Carriages pull up, deposit well-dressed guests, and rattle off again. The two guards at the main gate rotate with a second pair at some point, but honestly, from this distance, it\u2019s hard to tell much else.*\n\n*The estate is big. The walls are high. There are definitely guards. Beyond that? You\u2019d need to get closer \u2014 or find someone who\u2019s actually been inside.*\n\n**What they learn:** The estate is well-staffed and busy with gala prep. Two guards on the main gate at all times. That\u2019s it \u2014 no patrol routes, no hidden entrances, no useful details. They confirmed the job is real, but didn\u2019t gain a meaningful advantage.'
        },
        {
          id: 'a2-cond-scout-full', type: 'conditional',
          condition: 'If both Stealth and Perception pass',
          outcome: '*You find a spot across the street \u2014 a low stone wall with a decent sightline \u2014 and settle in. For the better part of an hour, you watch. And you start to notice things.*\n\n*The two guards at the main gate rotate every thirty minutes \u2014 a second pair comes from inside, and they swap without overlap. For about two minutes during each change, only one guard is actually watching the street while the other walks back in. That\u2019s a window.*\n\n*On the east side of the estate, there\u2019s a smaller door \u2014 a servants\u2019 entrance. Kitchen staff use it to haul in deliveries. It\u2019s not guarded, but someone inside checks it every few minutes. You watch a boy in a stained apron prop it open with a crate while he has a smoke. He doesn\u2019t close it when he goes back in.*\n\n*And one more thing \u2014 there\u2019s a section of the north wall, near the back gardens, where the iron fence meets an old stone wall. Ivy has grown thick over it. The top of the wall is lower there \u2014 maybe eight feet. No one patrols that section. At least, not while you were watching.*\n\n**What they learn:** Guard rotation every 30 min with a 2-minute gap at the main gate. Unguarded servants\u2019 entrance on the east side (often propped open). A climbable section of the north wall near the gardens (~8 ft, ivy-covered, unpatrolled). This is the best possible scouting result \u2014 it opens up multiple infiltration advantages.'
        },
        {
          id: 'a2-cond-scout-fail', type: 'conditional',
          condition: 'If Stealth fails',
          outcome: 'A guard spots them lingering. **+1 Heat** at the start of infiltration. The guard will remember their face.'
        }
      ]
    },
    {
      id: 'act-2-intel-2', title: 'Intel 2: Bribing a Servant (Pip)',
      blocks: [
        {
          id: 'a2-read-pip-1', type: 'read-aloud',
          vtt: { scene: 'S05' },
          text: 'You find what you\u2019re looking for at a cheap bakery near the ward line \u2014 the kind of place estate servants go on their breaks because they can\u2019t afford to eat where they work. A skinny young man in a stained kitchen apron is sitting alone at a corner table, picking at a meat pie and looking like he\u2019d rather be anywhere else. He\u2019s got the look \u2014 underpaid, overworked, and one bad day from quitting.'
        },
        {
          id: 'a2-check-pip-invest', type: 'skill-check',
          check: 'Investigation', dc: 12,
          details: 'To find a disgruntled servant.'
        },
        {
          id: 'a2-check-pip-persuade', type: 'skill-check',
          check: 'Persuasion', dc: 13,
          details: 'Or 50 gp bribe (no check needed with gold). Martin +5 or Jean +6 \u2014 easy for either, needs 8+ or 7+.'
        },
        {
          id: 'a2-cond-pip-success', type: 'conditional',
          condition: 'If Persuasion succeeds or bribe is paid',
          outcome: '*Pip glances over both shoulders, then leans in close. He smells like onion soup and anxiety.*\n\n*\u201CThe study \u2014 it\u2019s third floor. Big oak door, always locked. Lord Veymar keeps the key on him, on a chain around his neck, never takes it off. I\u2019ve never been up there \u2014 nobody has except him and the Captain.\u201D*\n\n*He chews his lip.*\n\n*\u201CBut there\u2019s \u2014 look, there\u2019s an old dumbwaiter in the kitchen. Service lift, yeah? Goes up to the second floor, to the hallway outside the guest rooms. Nobody uses it anymore, but it still works. I\u2019ve seen the pulleys move. If you\u2019re small enough \u2014 or clever enough \u2014 that\u2019s a way up without being seen.\u201D*\n\n*He holds out his hand, palm up.*\n\n*\u201CWe never spoke. Yeah?\u201D*'
        },
        {
          id: 'a2-cond-pip-fail', type: 'conditional',
          condition: 'If Persuasion fails',
          outcome: 'Pip gets scared and reports them. **+1 Heat** at infiltration. Pip won\u2019t talk again.'
        }
      ]
    },
    {
      id: 'act-2-intel-3', title: 'Intel 3: Speaking to Veymar\u2019s Rivals',
      blocks: [
        {
          id: 'a2-read-thorne-1', type: 'read-aloud',
          vtt: { scene: 'S06' },
          text: 'It doesn\u2019t take long to find someone who dislikes Lord Veymar \u2014 the harder part is finding someone willing to talk about it openly. A few well-placed questions at a Sea District tea house lead you to Lord Cassius Thorne, a silver-haired nobleman with sharp features and the comfortable posture of a man who has never worried about money. He\u2019s holding court at a corner table, half-finished glass of wine in hand, and he raises an eyebrow when Veymar\u2019s name comes up.'
        },
        {
          id: 'a2-check-thorne-invest', type: 'skill-check',
          check: 'Investigation', dc: 14,
          details: 'To find the right noble contact.'
        },
        {
          id: 'a2-check-thorne-persuade', type: 'skill-check',
          check: 'Persuasion or Intimidation', dc: 15,
          details: 'Jean is a natural \u2014 Knight background, \u201Celoquent flattery\u201D personality, Persuasion +6 vs DC 15 needs 9+. Martin can assist with Performance +7.'
        },
        {
          id: 'a2-cond-thorne-success', type: 'conditional',
          condition: 'If Persuasion/Intimidation succeeds',
          outcome: '*Lord Cassius Thorne swirls his wine and examines you with the amused detachment of someone who enjoys watching other people\u2019s problems.*\n\n*\u201CAldric Veymar. Oh, where to begin. Three months ago, he purchased the salvage rights to a shipwreck off the Sword Coast \u2014 paid a fortune for it, outbid half the Merchant\u2019s Guild. Everyone assumed it was about the cargo. Silks, spices, the usual. But no.\u201D*\n\n*He leans in, lowering his voice to a conspiratorial hush.*\n\n*\u201CHe found something on that ship. Some kind of box. Small thing \u2014 you could hold it in one hand. And ever since, he\u2019s been\u2026 different. Obsessed. He cancelled his standing appointments at the club. Dismissed half his household staff. Spends every evening in his study with the door locked.\u201D*\n\n*He taps the rim of his glass.*\n\n*\u201CSpeaking of which \u2014 if you\u2019re planning to visit that study, you should know he\u2019s had it warded. Magical protections on the door. Quite serious ones, from what I hear. The kind you hire a wizard for.\u201D*\n\n*He smiles thinly.*\n\n*\u201CI do hope whatever you\u2019re planning causes him enormous inconvenience.\u201D*\n\n**Arcane ward:** DC 16 Arcana or Thieves\u2019 Tools to bypass.'
        },
        {
          id: 'a2-cond-thorne-fail', type: 'conditional',
          condition: 'If checks fail',
          outcome: 'Thorne reports their inquiries to Veymar. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-2-intel-4', title: 'Intel 4: Checking the Black Market (Knuckles)',
      blocks: [
        {
          id: 'a2-read-knuckles-1', type: 'read-aloud',
          vtt: { scene: 'S06' },
          text: 'Gareth \u201CKnuckles\u201D Brune operates out of a stall in the Dock District\u2019s undermarket \u2014 a maze of canvas-covered tables and unmarked crates that technically doesn\u2019t exist, as far as the City Watch is concerned. You find him where he always is: leaning against the back wall behind a counter of \u201Csalvaged goods,\u201D a heavyset man with scarred knuckles and eyes that have already appraised you, your gear, and your coin purse before you\u2019ve said a word.'
        },
        {
          id: 'a2-check-knuckles', type: 'skill-check',
          check: 'Streetwise/Investigation', dc: 12,
          details: 'Dock District characters have advantage. The Rogue fits thematically. The Masterwork Thieves\u2019 Tools +2 bonus is valuable for Act 5 \u2014 encourage purchase if the Rogue\u2019s base tools aren\u2019t enough.'
        },
        {
          id: 'a2-cond-knuckles-success', type: 'conditional',
          condition: 'If Investigation succeeds',
          outcome: '*Knuckles leans against the back wall of his stall, arms folded, chewing something that might be tobacco and might not be.*\n\n*\u201CVeymar\u2019s box. Yeah, I\u2019ve heard the whispers. You\u2019re not the first crew asking about it \u2014 Ren\u2019s Jackdaws have been poking around all week. Sloppy about it, too. If they haven\u2019t tipped off Veymar\u2019s people already, they will.\u201D*\n\n*He spits.*\n\n*\u201CWord of advice? Move fast. Move tonight. And if you need an edge \u2014\u201D*\n\n*He reaches under the counter and produces two items: a small crystal vial of shimmering liquid and a leather roll of gleaming steel tools.*\n\n*\u201CPotion of Invisibility. Three hundred gold. Or masterwork picks \u2014 finest set in the Dock District. Two hundred. Take one, take both, take neither. I don\u2019t give refunds and I don\u2019t remember faces.\u201D*\n\n**Potion of Invisibility** (300 gp) or **Masterwork Thieves\u2019 Tools** (+2 bonus, 200 gp).'
        },
        {
          id: 'a2-cond-knuckles-fail', type: 'conditional',
          condition: 'If Investigation fails',
          outcome: 'Word gets out. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-2-intel-5', title: 'Intel 5: Drinking with the Guards',
      blocks: [
        {
          id: 'a2-read-guards-1', type: 'read-aloud',
          vtt: { scene: 'S07' },
          text: 'The Broken Oar is two blocks from the Rusty Anchor and caters to a rougher crowd \u2014 off-duty soldiers, dock workers, and estate guards who want to drink somewhere their employers won\u2019t see them. A couple of men in plain clothes are sitting at the bar, but you clock them immediately \u2014 the posture, the calluses, the way they scan the room out of habit. These are Veymar\u2019s guards, off shift and three ales into forgetting about it.'
        },
        {
          id: 'a2-check-guards-con', type: 'skill-check',
          check: 'Constitution', dc: 13,
          details: 'To stay sober.'
        },
        {
          id: 'a2-check-guards-social', type: 'skill-check',
          check: 'Deception or Persuasion', dc: 14,
          details: 'To steer conversation. Send Jean \u2014 Knight background, \u201Cinsatiable desire for decadent pleasures\u201D is his Flaw, CON +2 needs 11+, Persuasion +6 needs 8+. Great RP opportunity.'
        },
        {
          id: 'a2-cond-guards-success', type: 'conditional',
          condition: 'If both checks succeed',
          outcome: '*The guard \u2014 a stocky man with a crooked nose and three ales deep \u2014 slings an arm around the bar and grins.*\n\n*\u201CHelm? Oh, she runs a tight ship, don\u2019t get me wrong. But even the Captain\u2019s got her routine. Every night at midnight \u2014 midnight sharp, mind you \u2014 she goes up to report to Lord Veymar in his study. Twenty minutes, like clockwork. That\u2019s when things get\u2026 relaxed on the grounds, if you take my meaning.\u201D*\n\n*His buddy chimes in, sloshing his drink:*\n\n*\u201CAnd the ballroom \u2014 the east balcony? Nobody watches it during the performances. Everyone\u2019s inside watching the dancers. You could walk a horse across that balcony and nobody\u2019d notice.\u201D*\n\n*The first guard laughs and claps you on the back.*\n\n*\u201CWhy d\u2019you want to know all this, anyway? You\u2019re not thinking of robbing the place, are you?\u201D*\n\n*He laughs like it\u2019s the funniest joke he\u2019s ever told.*'
        },
        {
          id: 'a2-cond-guards-fail-con', type: 'conditional',
          condition: 'If Constitution fails',
          outcome: 'The PC gets drunk. **Disadvantage** on the first ability check of the infiltration. The guards laugh it off \u2014 no Heat.'
        },
        {
          id: 'a2-cond-guards-fail-dec', type: 'conditional',
          condition: 'If Deception fails',
          outcome: 'The guards get suspicious. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-2-intel-6', title: 'Intel 6: Gossiping with Groundskeepers',
      blocks: [
        {
          id: 'a2-read-grounds-1', type: 'read-aloud',
          vtt: { scene: 'S04' },
          text: 'The grounds crew doesn\u2019t work inside the estate \u2014 they work around it, and that means you can find them outside the walls. An old man in a wide-brimmed hat is trimming hedges along the public side of the fence, working with the slow, methodical pace of someone who\u2019s been doing this exact job for longer than you\u2019ve been alive. He\u2019s got dirt on every surface of his body and a watering can that looks older than the estate itself.'
        },
        {
          id: 'a2-check-grounds', type: 'skill-check',
          check: 'Persuasion', dc: 12,
          details: 'Or Animal Handling DC 14 (helping with the grounds earns trust). Oda \u2014 Outlander background, Animal Handling +6 needs 8+. Also sets up her ability to calm the Mastiffs later at DC 15.'
        },
        {
          id: 'a2-cond-grounds-success', type: 'conditional',
          condition: 'If Persuasion or Animal Handling succeeds',
          outcome: '*The old gardener \u2014 weathered hands, dirt under every nail \u2014 straightens up from his work and squints at you.*\n\n*\u201CBeen tending these grounds thirty years. Thirty years. I was here when Lord Veymar\u2019s father built the conservatory. And his father before that, he built the tunnels.\u201D*\n\n*He gestures vaguely toward the glass-walled building at the edge of the gardens.*\n\n*\u201CThere\u2019s a passage under the conservatory floor. Stone trapdoor, behind the big fern \u2014 the one with the red leaves. Goes down to the wine cellar. The old lord used it to move cases without tracking mud through the house. Nobody uses it anymore. Nobody remembers it.\u201D*\n\n*He pauses, then adds:*\n\n*\u201COh \u2014 and stay out of the hedge maze after dark. Two mastiffs patrol it. Big ones. Veymar\u2019s idea. Mean as sin unless you know how to talk to dogs.\u201D*'
        },
        {
          id: 'a2-cond-grounds-fail', type: 'conditional',
          condition: 'If checks fail',
          outcome: 'A loyal servant informs the household. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-2-gm-notes', title: 'GM Notes',
      blocks: [
        {
          id: 'a2-dm-tracking', type: 'dm-note',
          title: 'Intel Tracking',
          text: 'Track which intel they gathered \u2014 it opens or closes options in later acts.\n\n\u2022 If they got the tunnel info, they can use it in Act 3.\n\u2022 If they learned about the arcane ward, they can prepare to bypass it in Act 5.\n\u2022 If they got nothing? That\u2019s fine. The heist is harder but still possible.'
        }
      ]
    },
    {
      id: 'act-2-transition', title: 'Transition to Act 3 \u2014 Sundown',
      blocks: [
        {
          id: 'a2-narrative-transition', type: 'narrative',
          text: 'After the players have completed their intel attempts (or whenever the energy starts to flag), read this:'
        },
        {
          id: 'a2-read-transition', type: 'read-aloud',
          vtt: { scene: 'S08', titleCard: 3 },
          text: 'The sun touches the horizon, and the Sea District begins to glow. Lanterns flicker to life along the ward\u2019s main streets. From the direction of the Veymar estate, you can hear the faint sound of music starting up \u2014 strings, something elegant, the kind of music that costs more than your rent.\n\nThe gala has begun. Carriages are rolling through the streets. The gates are open. The house is full of noise, light, and a hundred potential witnesses.\n\nThis is it. Whatever you\u2019ve learned, whatever you\u2019ve planned \u2014 it\u2019s time to put it to work.\n\nHow are you getting in?'
        },
        {
          id: 'a2-dm-transition', type: 'dm-note',
          title: 'If Players Haven\u2019t Planned',
          text: 'If the players haven\u2019t discussed their entry plan yet, give them a minute to strategize. If they need a push, remind them of what they learned: *\u201CYou know about the servants\u2019 entrance on the east side\u2026\u201D* or *\u201CKnuckles mentioned the Jackdaws are also moving tonight \u2014 you may not want to wait.\u201D* Then move to Act 3.'
        }
      ]
    }
  ]
},
{
  id: 'act-3', number: 3, title: 'Infiltration: Getting Inside', duration: '~20-30 min',
  sections: [
    {
      id: 'act-3-arrival', title: 'Arrival at the Estate',
      blocks: [
        {
          id: 'a3-narrative-intro', type: 'narrative',
          text: 'The gala is underway. Carriages line the circular drive. Music and light pour from the ballroom windows. The estate is alive with activity \u2014 perfect cover, or a den of watchful eyes.'
        },
        {
          id: 'a3-read-1', type: 'read-aloud',
          vtt: { scene: 'S08', mode: 'theater' },
          text: 'The Veymar estate rises from the Sea District like a monument to old money. Three stories of pale stone, ivy-laced walls, and tall arched windows glowing amber from within. A wrought-iron fence rings the property, its gate flanked by two guards in polished half-plate. Beyond, you can hear the murmur of a hundred conversations and the lilting notes of a string quartet.'
        },
        {
          id: 'a3-dm-split', type: 'dm-note',
          title: 'Expected Party Split',
          text: 'This party will almost certainly split. The natural breakdown: **Martin + Jean** as the social team (Martin\u2019s Entertainer background + Performance +7, Jean\u2019s Knight background + Persuasion +6 \u2014 avoid the Fake Invitation route, DC 16 Deception is brutal for them at +1 and +3). **Rogue + Oda** as the stealth team (Wild Shape + lockpicking, aim for the study). **L\u00f3m\u00eb** is the wildcard \u2014 she can join the social group as Jean\u2019s \u201cspiritual advisor\u201d (Knight households often have chaplains), take the sewer route (CON +2 handles DC 12), or disguise as a servant (\u201cnew temple hire\u201d for the household chapel).'
        },
        {
          id: 'a3-narrative-entry-methods', type: 'narrative',
          text: 'The party should choose **one approach** (though creative combinations are fine). Each entry has a primary check and a consequence for failure.'
        }
      ]
    },
    {
      id: 'act-3-gate', title: '1. Main Gate \u2014 Bluff or Force',
      blocks: [
        {
          id: 'a3-read-gate-scene', type: 'read-aloud',
          vtt: { scene: 'S09' },
          text: 'The main gate is a grand affair \u2014 twin panels of wrought iron, each bearing the Veymar family crest in hammered bronze. Beyond it, a cobblestone drive curves through manicured lawns toward the front entrance. A dozen carriages idle along the approach, their drivers sharing a flask and trading gossip. The two guards at the gate stand with the relaxed posture of men who\u2019ve been checking invitations all evening and have grown bored of it \u2014 but their eyes are still sharp, and their halberds are not decorative.'
        },
        {
          id: 'a3-dm-gate-guards', type: 'dm-note',
          title: 'Guard Personalities at the Main Gate',
          text: 'The guards are professional but human. They\u2019ve been standing here for three hours. One is younger and more by-the-book; the other is a veteran who just wants the night to end.'
        },
        {
          id: 'a3-read-gate-npc', type: 'read-aloud',
          text: 'The older guard holds up a hand. \u201cEvening. Invitations, please.\u201d He says it the way a man says it for the fortieth time tonight \u2014 flat, rehearsed, already half-looking past you to the next carriage.\n\nThe younger one straightens up. \u201cNames on the list, ser. Lord Veymar\u2019s orders \u2014 no exceptions.\u201d'
        },
        {
          id: 'a3-narrative-gate-approach', type: 'narrative',
          text: '**Approach:** Talk their way past the guards or overpower them.'
        },
        {
          id: 'a3-check-gate-deception', type: 'skill-check',
          check: 'Deception', dc: 15,
          text: 'Claim to be guests, deliverymen, etc. Alternative: initiative for combat (2 Guards, see stat blocks).'
        },
        {
          id: 'a3-read-gate-success', type: 'read-aloud',
          text: 'The older guard glances at his partner, shrugs, and steps aside. The iron gate swings open on oiled hinges, and the sounds of the gala wash over you \u2014 laughter, clinking glass, the swell of strings. The cobblestone drive stretches ahead, lined with flickering lanterns. You\u2019re in. Just like that. Nobody looks twice at people who walk like they belong.'
        },
        {
          id: 'a3-narrative-gate-success', type: 'narrative',
          text: 'Walk right in through the front door.'
        },
        {
          id: 'a3-cue-gate-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-gate-fail-deception', type: 'conditional',
          condition: 'Failure (Deception)',
          outcome: 'The younger guard\u2019s eyes narrow. He takes a half-step forward, one hand drifting to the halberd. \u201cI don\u2019t have that name on the list, ser. And I\u2019ve been checking it all night.\u201d The older guard isn\u2019t smiling anymore either. He shakes his head slowly. \u201cBest move along. Lord Veymar doesn\u2019t appreciate uninvited company.\u201d\n\nTurned away. Must find another entry. **+1 Heat.**'
        },
        {
          id: 'a3-cond-gate-fail-combat', type: 'conditional',
          condition: 'Failure (Combat)',
          outcome: 'The halberd comes down with a crack against the cobblestones \u2014 not a swing, a signal. Before you can blink, a whistle shrieks from somewhere on the wall, and lanterns that were dim a moment ago flare to life along the perimeter. You hear boots on gravel \u2014 more guards, coming fast.\n\nIf they fight, it\u2019s loud. **+2 Heat immediately (Alarmed).**'
        }
      ]
    },
    {
      id: 'act-3-servant', title: '2. Servant\u2019s Entrance (East Side)',
      blocks: [
        {
          id: 'a3-read-servant-scene', type: 'read-aloud',
          vtt: { scene: 'S10' },
          text: 'The east side of the estate is quieter \u2014 no carriages, no lanterns, no guests. Just a narrow alley between the outer wall and a row of hedges, and at the far end, a plain wooden door set into the stone. The smell of roasting meat and baking bread drifts from a vent above the door \u2014 the kitchen is just on the other side. You can hear the muffled clatter of pots, the bark of a head cook giving orders, and someone laughing. A single guard paces a slow circuit along this stretch of wall, pausing every few minutes to lean against a buttress and pick at his fingernails.'
        },
        {
          id: 'a3-narrative-servant-requires', type: 'narrative',
          text: '**Requires:** Scouting intel or Pip\u2019s info (otherwise they don\u2019t know it exists \u2014 DC 16 Perception to find it blind).'
        },
        {
          id: 'a3-dm-servant-tactics', type: 'dm-note',
          title: 'Stealth Tactics and Oda\u2019s Wild Shape',
          text: 'If the party bribed Pip, they know the door is often propped open during the busiest kitchen hours. Oda\u2019s Stealth +4 is borderline here \u2014 the Rogue should take point. If Oda wants to Wild Shape into a cat, that\u2019s smart: cats don\u2019t arouse suspicion near a kitchen. Let her bypass the Stealth check with a DC 12 Animal Handling (she has +6, needs a 6+) to act like a convincing stray.'
        },
        {
          id: 'a3-read-servant-npc', type: 'read-aloud',
          text: 'The guard straightens up, squinting into the dark. \u201cOi \u2014 who\u2019s there? Kitchen\u2019s closed to outside staff.\u201d He doesn\u2019t draw his sword, but his hand rests on the pommel. \u201cIf you\u2019re with the catering company, you\u2019re late. Use the front and talk to the steward.\u201d'
        },
        {
          id: 'a3-check-servant-stealth', type: 'skill-check',
          check: 'Stealth', dc: 13,
          text: 'A single guard patrols this area.'
        },
        {
          id: 'a3-check-servant-lock', type: 'skill-check',
          check: 'Sleight of Hand', dc: 12,
          text: 'The door is locked \u2014 simple lock.'
        },
        {
          id: 'a3-read-servant-success', type: 'read-aloud',
          text: 'The guard turns the corner, and you move. The lock yields with a soft click \u2014 a simple mechanism, barely worth the pick. The door swings inward on silent hinges, and a wall of heat and noise hits you: the roar of ovens, the clang of copper pans, steam rising from a dozen pots. Nobody looks up. Every servant in the kitchen is moving at a dead sprint \u2014 trays of glazed pheasant, towers of pastry, a boy hauling a cask of wine that weighs more than he does. You slip through the chaos like another pair of hands that nobody has time to question.'
        },
        {
          id: 'a3-narrative-servant-success', type: 'narrative',
          text: 'Slip in through the kitchen corridor.'
        },
        {
          id: 'a3-cue-servant-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-servant-fail', type: 'conditional',
          condition: 'Failure (Stealth or Sleight of Hand)',
          outcome: 'The guard\u2019s head snaps up. He drops the fingernail he was worrying at and takes three quick strides toward you, one hand on his sword. \u201cYou \u2014 stay right there!\u201d His voice carries. From inside the kitchen, you hear the clatter of a dropped tray, and someone shouts, \u201cWhat\u2019s going on out there?\u201d\n\nThe guard calls for backup. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-3-wall', title: '3. Scaling the Wall (West Side)',
      blocks: [
        {
          id: 'a3-read-wall-scene', type: 'read-aloud',
          vtt: { scene: 'S11' },
          text: 'The west side of the estate backs up against a row of townhouses, their upper windows dark. The stone wall here is old \u2014 older than the rest of the estate, probably part of the original property before the Veymars rebuilt. Rough-cut blocks, thick with ivy, the mortar crumbling in places. Twelve feet high, give or take. Beyond the wall, you can see the dark shapes of garden topiaries and hear the faint trickle of a fountain. Up on the roof of the estate\u2019s west wing, a figure leans against a chimney \u2014 an archer, silhouetted against the sky, a longbow slung across his back. He\u2019s watching the garden, but every few seconds his gaze sweeps the wall.'
        },
        {
          id: 'a3-dm-wall-tactics', type: 'dm-note',
          title: 'Best Characters for Wall Climbing',
          text: 'The Rogue is the natural pick here \u2014 Stealth expertise makes the DC 14 comfortable. Oda in spider form can bypass the Athletics check entirely (spider climb). If Jean tries to climb in his plate armor, he has disadvantage on the Athletics check \u2014 he\u2019s going to clank. Keep him away from this route.'
        },
        {
          id: 'a3-check-wall-athletics', type: 'skill-check',
          check: 'Athletics', dc: 14,
          text: 'The wall is 12 feet, rough stone.'
        },
        {
          id: 'a3-check-wall-stealth', type: 'skill-check',
          check: 'Stealth', dc: 14,
          text: 'A rooftop archer has line of sight.'
        },
        {
          id: 'a3-read-wall-success', type: 'read-aloud',
          text: 'Your fingers find the gaps in the mortar \u2014 one handhold, then two, then your foot catches on a ridge of ivy-thick stone and you pull yourself up. The wall bites cold into your palms. At the top, you flatten yourself against the capstones and wait. The archer on the roof turns, scans the far side of the garden, and you drop \u2014 silent, controlled \u2014 into a bed of soft earth and trimmed lavender. The scent rises around you, sharp and clean. Above, the archer turns back. He sees nothing. The garden stretches ahead, dark and inviting.'
        },
        {
          id: 'a3-narrative-wall-success', type: 'narrative',
          text: 'Over the wall, into the gardens.'
        },
        {
          id: 'a3-cue-wall-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-wall-fail-athletics', type: 'conditional',
          condition: 'Failure (Athletics)',
          outcome: 'Your fingers slip. The ivy tears free in a clump, and for a sickening moment you\u2019re hanging by one hand, feet scrabbling against smooth stone \u2014 and then you\u2019re falling. The ground meets you hard, knocking the wind from your lungs. You lie there for a moment, staring up at the wall that just beat you, the taste of dirt in your mouth.\n\nFall, take **1d6 bludgeoning**, must retry or find another way.'
        },
        {
          id: 'a3-cond-wall-fail-stealth', type: 'conditional',
          condition: 'Failure (Stealth)',
          outcome: 'You\u2019re halfway up when you hear it \u2014 the creak of a bow being drawn. The archer on the roof has turned, and he\u2019s looking right at you, framed against the wall like a fly on a tablecloth. He doesn\u2019t shoot. He doesn\u2019t have to. He puts two fingers to his lips and lets out a whistle that cuts through the garden like a knife.\n\nThe archer raises an alarm. **+1 Heat.**'
        }
      ]
    },
    {
      id: 'act-3-sewers', title: '4. The Sewers (Beneath the Estate)',
      blocks: [
        {
          id: 'a3-read-sewers-scene', type: 'read-aloud',
          vtt: { scene: 'S27' },
          text: 'The entrance to the sewer system is a rusted iron grate set into the cobblestones of a back alley, two blocks south of the estate. When you pull it open, the smell hits you first \u2014 wet stone, stagnant water, and something organic and deeply unpleasant that you don\u2019t want to think too hard about. A rusted ladder descends into darkness. Below, you can hear the echo of running water and the occasional skittering of things that live where the light doesn\u2019t reach. The tunnels are old \u2014 pre-Veymar, pre-Sea District, maybe pre-Waterdeep. They go everywhere. Including, if your sense of direction holds, directly beneath the estate.'
        },
        {
          id: 'a3-dm-sewers-tactics', type: 'dm-note',
          title: 'Best Characters for the Sewer Route',
          text: 'L\u00f3m\u00eb is well-suited for this route \u2014 CON +2 handles the DC 12, Religion +6 might help her recognize old temple carvings in the tunnel walls (flavor only), and Darkvision means she doesn\u2019t need a torch. The Rogue can navigate (Survival or Thieves\u2019 Tools proficiency for reading the tunnel layout). If anyone with low CON takes this route, warn them: *\u201cThe smell gets worse the deeper you go. Much worse.\u201d*'
        },
        {
          id: 'a3-check-sewers-survival', type: 'skill-check',
          check: 'Survival', dc: 13,
          text: 'Navigating the tunnels.'
        },
        {
          id: 'a3-check-sewers-con', type: 'skill-check',
          check: 'Constitution', dc: 12,
          text: 'The smell is atrocious.'
        },
        {
          id: 'a3-read-sewers-encounter', type: 'read-aloud',
          text: 'A voice from the dark. \u201cLeft at the third fork. Don\u2019t take the right \u2014 that one floods.\u201d A figure shuffles past you in the ankle-deep water, carrying a hooded lantern that throws wild shadows on the walls. He doesn\u2019t stop, doesn\u2019t look at you. \u201cAnd hold your breath past the old cistern. Trust me.\u201d'
        },
        {
          id: 'a3-dm-sewers-encounter', type: 'dm-tip',
          title: 'Optional Sewer Worker Encounter',
          text: 'If you want to add tension, have the party encounter this half-mad sewer worker (not hostile, just startling) who mumbles directions before shuffling off into the dark. Pure flavor \u2014 use it if the pacing needs a beat of atmosphere.'
        },
        {
          id: 'a3-read-sewers-success', type: 'read-aloud',
          vtt: { scene: 'S31' },
          text: 'The tunnels twist and branch, but you keep your bearings \u2014 left, then straight, then down a set of ancient stone steps that are slick with something you refuse to examine. The air gets colder, cleaner, and then you see it: a wooden trapdoor in the ceiling, light seeping through the cracks. You push it open and the smell of aged oak and fermented grapes floods your senses. Wine racks. Hundreds of bottles, resting in stone alcoves, stretching back into the dark. You\u2019re in the cellar. You\u2019re beneath the estate. And nobody knows you\u2019re here.'
        },
        {
          id: 'a3-narrative-sewers-success', type: 'narrative',
          text: 'Emerge in the basement wine cellar. Bypasses all exterior security.'
        },
        {
          id: 'a3-cue-sewers-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-sewers-fail-survival', type: 'conditional',
          condition: 'Failure (Survival)',
          outcome: 'Every tunnel looks the same \u2014 wet stone, brackish water, the same dripping echo from every direction. You double back twice, take a wrong turn at what might have been the third fork or the fourth, and waste precious time retracing your steps through water that\u2019s getting deeper. By the time you find the right trapdoor, you\u2019ve lost almost an hour.\n\nLost for a while \u2014 lose time. No Heat, but **one less round of exploration** in the mansion.'
        },
        {
          id: 'a3-cond-sewers-fail-con', type: 'conditional',
          condition: 'Failure (Constitution)',
          outcome: 'The old cistern is the worst of it. The water here is black and still, and the stench that rises from it is something primal \u2014 your body rebels before your mind catches up. Your stomach heaves. Your eyes water. You press on, but the damage is done. The taste sits in the back of your throat, and every breath feels like swallowing something rotten. You can\u2019t shake it.\n\n**Poisoned condition for 1 hour** (disadvantage on attack rolls and ability checks). Nasty.'
        }
      ]
    },
    {
      id: 'act-3-garden', title: '5. Hidden Garden Passage (Conservatory)',
      blocks: [
        {
          id: 'a3-read-garden-scene', type: 'read-aloud',
          vtt: { scene: 'S12' },
          text: 'The conservatory is a beautiful structure \u2014 glass walls and an iron frame, glowing faintly from the phosphorescent orchids within. It sits at the edge of the formal gardens, half-hidden by the hedge maze that sprawls out from its entrance. The air here smells of wet earth and night-blooming jasmine. From somewhere inside the maze, you hear the low, guttural sound of a dog panting \u2014 then a second one, deeper. The mastiffs. They\u2019re close.'
        },
        {
          id: 'a3-narrative-garden-requires', type: 'narrative',
          text: '**Requires:** Groundskeeper intel (otherwise unknown).'
        },
        {
          id: 'a3-dm-garden-tactics', type: 'dm-note',
          title: 'Oda\u2019s Route \u2014 Animal Handling and Wild Shape',
          text: 'This is Oda\u2019s route. Animal Handling +6 vs DC 15 means she needs a 9+ \u2014 doable but not guaranteed. If she Wild Shapes into a dog, give her advantage on the check (pack behavior). If the Rogue is with her, they can take the Stealth option while Oda handles the dogs. Splitting the challenge between two characters is smart \u2014 reward it.'
        },
        {
          id: 'a3-read-garden-mastiffs', type: 'read-aloud',
          text: 'Two shapes materialize from the hedge maze \u2014 massive dogs, barrel-chested, with broad skulls and cropped ears. They don\u2019t bark. They don\u2019t growl. They just stop, twenty feet away, and stare at you with the flat, unblinking focus of animals that have been trained to decide very quickly whether you\u2019re a threat. One of them lowers its head. The muscles in its shoulders bunch.'
        },
        {
          id: 'a3-check-garden-animal', type: 'skill-check',
          check: 'Animal Handling', dc: 15,
          text: 'Calm the mastiffs. Alternative: Stealth DC 14 to avoid them entirely.'
        },
        {
          id: 'a3-check-garden-stealth', type: 'skill-check',
          check: 'Stealth', dc: 14,
          text: 'Avoid the mastiffs through the hedge maze.'
        },
        {
          id: 'a3-read-garden-success-animal', type: 'read-aloud',
          text: 'You lower yourself slowly \u2014 no sudden movements \u2014 and extend a hand, palm down. The lead mastiff approaches, stiff-legged, ears flat. It sniffs your hand. Its nostrils flare. For a long, taut moment, nothing happens. Then the tail moves \u2014 just once, a slow wag. The second dog follows its partner\u2019s lead, and within a minute they\u2019re both pressing their heads against your legs, tongues lolling, the threat forgotten. You scratch behind an ear that\u2019s bigger than your hand, and the mastiff\u2019s whole body relaxes. Beyond them, the conservatory door is unguarded.'
        },
        {
          id: 'a3-read-garden-success-stealth', type: 'read-aloud',
          text: 'You press yourself into the hedge wall and hold your breath. One of the mastiffs passes within arm\u2019s reach \u2014 close enough to feel the heat of its body, to hear the wet rhythm of its breathing. It pauses. Sniffs the air. Your heart hammers against your ribs. Then it moves on, following some scent trail deeper into the maze. You slip through the gap it left and reach the conservatory door without a sound.'
        },
        {
          id: 'a3-narrative-garden-success', type: 'narrative',
          text: 'Enter through the conservatory. Inside, behind the big fern with red leaves \u2014 the stone trapdoor, just like the groundskeeper described. It opens onto a set of narrow stone stairs leading down to the wine cellar.'
        },
        {
          id: 'a3-cue-garden-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-garden-fail', type: 'conditional',
          condition: 'Failure (Animal Handling or Stealth)',
          outcome: 'The lead mastiff throws its head back and lets out a bark that echoes off the estate walls like a thunderclap. The second joins in \u2014 a deep, booming alarm that shreds the quiet of the garden. Lights flare in the guard house. You hear voices, boots on gravel, the metallic ring of weapons being drawn. The dogs don\u2019t chase you. They don\u2019t have to. They\u2019ve done their job.\n\nDogs bark. **+1 Heat.** Guards investigate the conservatory.'
        }
      ]
    },
    {
      id: 'act-3-invite', title: '6. Fake Invitation (Front Door)',
      blocks: [
        {
          id: 'a3-read-invite-scene', type: 'read-aloud',
          vtt: { scene: 'S09' },
          text: 'The front entrance is a spectacle in itself. A red carpet has been laid down the front steps, flanked by enchanted lanterns that shift through jewel tones \u2014 emerald, sapphire, ruby. Guests arrive in pairs and small groups, the women in silk and brocade, the men in velvet doublets with silver buttons. A steward in a pressed black coat stands at the door, checking invitations against a leather-bound ledger with the pinched efficiency of a man who memorized the guest list three days ago. His quill scratches, his eyes flick up, his smile is practiced and empty. Beyond him, through the open doors, you can see the ballroom \u2014 a cathedral of candlelight, with a crystal chandelier the size of a carriage throwing prismatic light across a hundred upturned faces.'
        },
        {
          id: 'a3-dm-invite-difficulty', type: 'dm-note',
          title: 'Hardest Social Route \u2014 Consider Alternatives',
          text: 'This is the hardest social route. DC 16 Deception to forge or present a fake invitation is brutal for this party \u2014 their best Deception is Jean at +3. Only recommend this if the Rogue has Deception proficiency or the party acquired actual invitations during Act 2. If they insist, Martin can use Performance DC 14 as a secondary check to \u201csell the act,\u201d which is more in his wheelhouse (+7). But honestly, steer them toward Entry 7 (Performer\u2019s Entrance) if they want the front door \u2014 it\u2019s built for Martin.'
        },
        {
          id: 'a3-check-invite-forgery', type: 'skill-check',
          check: 'Forgery/Deception', dc: 16,
          text: 'Create or acquire a convincing invitation.'
        },
        {
          id: 'a3-check-invite-act', type: 'skill-check',
          check: 'Performance or Deception', dc: 14,
          text: 'Act the part of a noble.'
        },
        {
          id: 'a3-read-invite-npc', type: 'read-aloud',
          text: 'The steward\u2019s smile doesn\u2019t waver, but his eyes do the work \u2014 they drop to your clothes, your shoes, the quality of the parchment you\u2019re holding, all in the space of a breath.\n\n\u201cGood evening. Your invitation, if you please.\u201d He extends a gloved hand. His other hand hovers near the ledger, quill poised.'
        },
        {
          id: 'a3-read-invite-success', type: 'read-aloud',
          text: 'The steward examines the invitation, glances at his ledger, and makes a small, precise checkmark. \u201cVery good, my lord. Welcome to the Veymar estate.\u201d He steps aside with a practiced bow, and the doors are open. The ballroom swallows you in warmth and light \u2014 the perfume of a hundred nobles, the shimmer of silk, the cascade of a harp being played in the far corner. A servant materializes at your elbow with a silver tray of champagne flutes. You take one. You belong here. At least, tonight you do.'
        },
        {
          id: 'a3-narrative-invite-success', type: 'narrative',
          text: 'Walk in as a guest. Full access to the ballroom and ground floor. Best social infiltration route.'
        },
        {
          id: 'a3-cue-invite-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-invite-fail', type: 'conditional',
          condition: 'Failure (Forgery/Deception or Performance)',
          outcome: 'The steward\u2019s quill stops. He looks up from the ledger, and the practiced smile is gone, replaced by the particular expression of a man who has found a discrepancy.\n\n\u201cI\u2019m terribly sorry, but I don\u2019t seem to have this name on tonight\u2019s list. One moment.\u201d He raises a hand, and you see a guard in polished half-plate approaching from the foyer. \u201cCaptain Helm will want to have a brief word. I\u2019m sure it\u2019s just a misunderstanding.\u201d\n\nCaptain Helm is called. Questioned and escorted out. **+1 Heat.** Can still re-enter another way.'
        }
      ]
    },
    {
      id: 'act-3-performer', title: '7. Performer\u2019s Entrance (Martin)',
      blocks: [
        {
          id: 'a3-read-performer-scene', type: 'read-aloud',
          vtt: { scene: 'S29' },
          text: 'The side entrance near the ballroom\u2019s service corridor is a controlled chaos of its own \u2014 musicians tuning instruments, a fire-eater practicing in the alley, two acrobats stretching against the wall, and a flustered woman with a clipboard pacing back and forth, her hair escaping its pins. This is where the entertainment checks in. The smell of rosin, sweat, and stage paint hangs in the air. A hand-painted sign on an easel reads: \u201cPERFORMERS \u2014 CHECK IN WITH MADAME LYSARA. NO EXCEPTIONS. NO WALK-INS. I MEAN IT.\u201d'
        },
        {
          id: 'a3-narrative-performer-approach', type: 'narrative',
          text: '**Approach:** Martin uses his Entertainer background to talk his way in as the evening\u2019s musical act (or a last-minute addition to the entertainment lineup).'
        },
        {
          id: 'a3-dm-performer-tactics', type: 'dm-note',
          title: 'Martin\u2019s Moment \u2014 Let Him Shine',
          text: 'This is Martin\u2019s moment. Performance +7 against DC 14 means he needs a 7 \u2014 he\u2019ll almost certainly nail it. Let Robben describe his character\u2019s pitch. If Martin offers to audition on the spot, drop the Performance DC to 12 (let him show off \u2014 that\u2019s what Bards are for). The Deception DC 12 secondary check is low intentionally \u2014 performing *is* Martin\u2019s truth. He\u2019s not lying about being an entertainer. He\u2019s barely even stretching.'
        },
        {
          id: 'a3-read-performer-npc', type: 'read-aloud',
          text: 'The woman with the clipboard looks up as Martin approaches. She has the harried energy of someone who has dealt with six emergencies in the last hour and is bracing for the seventh.\n\n\u201cAre you on my list? Please tell me you\u2019re on my list.\u201d She flips through pages without waiting for an answer. \u201cI had a lutist cancel \u2014 food poisoning, he says, though I suspect cold feet \u2014 and the contortionist is drunk, and Lord Veymar specifically requested a vocalist for the midnight set, which I do not have, because apparently nobody in this city can carry a tune and also show up on time.\u201d\n\nShe stops flipping and looks at Martin \u2014 really looks at him, for the first time.\n\n\u201cWait. Are you a musician? Please, for the love of all that is holy, tell me you are a musician.\u201d'
        },
        {
          id: 'a3-cond-performer-yes', type: 'conditional',
          condition: 'If Martin says yes (or performs a sample)',
          outcome: 'Lysara\u2019s eyes widen. She grabs Martin by the arm \u2014 not gently \u2014 and starts pulling him toward the service entrance.\n\n\u201cYou\u2019re hired. I don\u2019t care what your name is. I don\u2019t care where you came from. Can you play for two hours? Can you do requests? Never mind, it doesn\u2019t matter. You\u2019re on at eleven. The green room is through that door, second left, don\u2019t touch the wine \u2014 that\u2019s for the guests. Do you have a page-turner? An assistant? Bring them, I don\u2019t care, just be ready at eleven.\u201d'
        },
        {
          id: 'a3-check-performer-performance', type: 'skill-check',
          check: 'Performance', dc: 14,
          text: 'Convince the event coordinator or the guards he\u2019s legitimate.'
        },
        {
          id: 'a3-check-performer-deception', type: 'skill-check',
          check: 'Deception', dc: 12,
          text: 'Sell the story if questioned further \u2014 low DC because performing *is* his truth.'
        },
        {
          id: 'a3-read-performer-success', type: 'read-aloud',
          text: 'Martin walks through the service entrance like he\u2019s done it a hundred times before \u2014 because he has, at a hundred other venues. The corridor smells of candle wax and polished wood. A stagehand nods to him, another hands him a glass of water without being asked. This is backstage. This is his world. He knows the rhythm of it \u2014 the nervous energy, the last-minute tuning, the hush before the curtain. Through a gap in the stage drapes, he can see the ballroom: packed, glittering, expectant. They don\u2019t know it yet, but the best performer of the evening just walked in through the back door.'
        },
        {
          id: 'a3-narrative-performer-success', type: 'narrative',
          text: 'Martin enters through the main entrance with his instruments, given access to the ballroom and servants\u2019 areas. He can bring one companion as his \u201cassistant\u201d (instrument carrier, page-turner, etc.).'
        },
        {
          id: 'a3-cue-performer-map', type: 'vtt-cue',
          label: 'Switch to Estate Grounds Map',
          vtt: { map: 'M02', mode: 'map' }
        },
        {
          id: 'a3-cond-performer-fail', type: 'conditional',
          condition: 'Failure (Performance or Deception)',
          outcome: 'Lysara squints at her clipboard, then at Martin, then back at the clipboard. She shakes her head.\n\n\u201cI\u2019m sorry, love. I appreciate the initiative, truly, but we\u2019ve got a full program tonight and Lord Veymar approved the lineup personally. I can\u2019t just add people.\u201d She pats his arm with genuine sympathy. \u201cTry the Moonstone Mask \u2014 they\u2019re always looking for talent. Tell them Lysara sent you.\u201d\n\nTurned away \u2014 \u201cWe already have a full program tonight.\u201d No Heat (it\u2019s a reasonable approach, just bad luck). Can try another method.'
        },
        {
          id: 'a3-dm-performer-why', type: 'dm-tip',
          title: 'Why This Route Exists',
          text: 'Martin has Performance +7 but Deception +1. This route plays to his actual strengths. If the party wants the front door, steer them here instead of the Fake Invitation.'
        }
      ]
    },
    {
      id: 'act-3-transitions', title: 'Transition \u2014 You\u2019re Inside. Now What?',
      blocks: [
        {
          id: 'a3-narrative-transitions-intro', type: 'narrative',
          text: 'Once the party is inside \u2014 whether through one entrance or split across several \u2014 read the appropriate passage based on where they entered:'
        },
        {
          id: 'a3-cond-transition-front', type: 'conditional',
          condition: 'Entered through the front (Main Gate, Fake Invitation, or Performer\u2019s Entrance)',
          outcome: 'The warmth of the ballroom envelops you. Candlelight catches on crystal and silver. The string quartet has shifted into something slow and stately, and a hundred conversations blend into a single, thrumming hum. Servants weave between guests with trays of champagne and canap\u00e9s. No one is looking at you. Everyone is looking at everyone else. Somewhere above you \u2014 up past the grand staircase, past the second-floor gallery, behind a locked door on the third floor \u2014 is a puzzle box that someone is paying you a lot of gold to steal.\n\nThe clock in the foyer reads half past nine. Dawn is a long way off. But the night isn\u2019t going to wait for you.'
        },
        {
          id: 'a3-cond-transition-kitchen', type: 'conditional',
          condition: 'Entered through the kitchen or servant\u2019s entrance',
          outcome: 'The kitchen corridor is narrow, hot, and loud. Steam hisses from somewhere, and a cook shouts an order that nobody acknowledges. You press against the wall as a servant rushes past with a tureen of soup, and then you\u2019re through \u2014 into a quieter hallway, dimly lit, with a servants\u2019 staircase rising to the left and the distant sound of music drifting from the ballroom to the right. You are backstage in someone else\u2019s house. Every door you open from here is a gamble.'
        },
        {
          id: 'a3-cond-transition-cellar', type: 'conditional',
          condition: 'Entered through the wine cellar (Sewers or Conservatory Passage)',
          outcome: 'The wine cellar is cold and silent after the chaos of getting here. Racks of dusty bottles stretch into the dark, and the stone floor is dry and clean. A single staircase leads up \u2014 narrow, wooden, the steps worn smooth by decades of servants hauling bottles to dinner parties. At the top, you can see a sliver of light beneath a closed door. The muffled sounds of the gala filter down: music, laughter, the clink of glass. You\u2019re beneath the heart of the estate. Everything is above you now.'
        },
        {
          id: 'a3-cond-transition-garden', type: 'conditional',
          condition: 'Entered through the gardens (Scaling the Wall)',
          outcome: 'The garden is darker than you expected. Topiaries loom like sentinels, and the fountain gurgles somewhere to your left. The ballroom windows blaze with light on the far side of the grounds \u2014 you can see figures moving behind the glass, silhouettes dancing. Between you and the house: fifty yards of open lawn, a gravel path that will crunch underfoot, and the occasional sweep of a lantern from the upper windows. The back door is there. You just have to reach it.'
        },
        {
          id: 'a3-dm-reunion', type: 'dm-note',
          title: 'Reuniting a Split Party',
          text: 'If the party split up to use different entrances, this is the moment to reunite them. Ask each group: *\u201cWhere are you heading?\u201d* The natural convergence point is the **ground floor main hallway** \u2014 it connects the kitchen, the ballroom, and the main foyer. Or, if one group went through the cellar and another through the front, have them run into each other on the servants\u2019 staircase for a tense, funny moment of mutual recognition. Once everyone is inside and oriented, move to Act 4.'
        }
      ]
    }
  ]
},
{
  id: 'act-4',
  number: 4,
  title: 'Navigating the Mansion',
  duration: '~20-30 min',
  sections: [
    {
      id: 'act-4-layout',
      title: 'Mansion Layout',
      blocks: [
        {
          id: 'a4-table-layout',
          type: 'table',
          headers: ['Ground Floor', 'Second Floor', 'Third Floor'],
          rows: [
            ['Ballroom (west)', 'Guest Rooms', 'Veymar\u2019s Study \u2605'],
            ['Dining Hall', 'Library', 'Private Gallery'],
            ['Kitchen / Servants\u2019 Quarters', 'Lady Thessaly\u2019s Parlor', 'Arcane Workshop'],
            ['Main Foyer', 'Upper Landing', 'Locked Stairwell (from 2nd floor)'],
            ['Wine Cellar (below)', '', '']
          ]
        },
        {
          id: 'a4-narrative-layout',
          type: 'narrative',
          text: 'The stairwell to the third floor is locked (Thieves\u2019 Tools DC 15 or the key, which Captain Helm carries). There\u2019s also a balcony on the third floor accessible from outside (Athletics DC 16 to climb up).'
        }
      ]
    },
    {
      id: 'act-4-tone',
      title: 'Setting the Tone',
      blocks: [
        {
          id: 'a4-read-tone',
          type: 'read-aloud',
          vtt: { titleCard: 4 },
          text: 'The inside of the Veymar estate hits you like stepping into another world. The ground floor hums with life \u2014 warm candlelight reflected in polished marble, the low murmur of a hundred overlapping conversations, the clink of crystal, the perfume of hothouse flowers competing with roasted meat and mulled wine. Somewhere deeper in the house, the string quartet shifts into a waltz, and the crowd responds like a living thing \u2014 bodies turning, dresses swirling, laughter rising and falling like waves.\n\nBut beneath all of it \u2014 beneath the music and the chatter and the warm golden light \u2014 there\u2019s the constant, quiet movement of people who are watching. A guard in polished half-plate stationed by the main staircase. A servant whose eyes linger a half-second too long. The flash of a captain\u2019s insignia disappearing around a corner.\n\nThis place is beautiful. It is also a cage with very attentive keepers.'
        }
      ]
    },
    {
      id: 'act-4-paths-intro',
      title: 'Three Paths to the Study',
      blocks: [
        {
          id: 'a4-dm-note-perception',
          type: 'dm-note',
          title: 'Jean\u2019s Blind Spot (Passive Perception 9)',
          text: 'Jean\u2019s Passive Perception is 9. He will walk past traps, wards, and clues without noticing. The other three (Martin, L\u00F3m\u00EB, Oda at passive 16) need to spot things and share info. This creates natural party dynamics \u2014 the observant characters guide the confident but oblivious paladin.'
        },
        {
          id: 'a4-narrative-paths-intro',
          type: 'narrative',
          text: 'Players will likely combine approaches. Present these as the natural options based on where they entered.'
        }
      ]
    },
    {
      id: 'act-4-path-a',
      title: 'Path A \u2014 Through the Ballroom (Social)',
      blocks: [
        {
          id: 'a4-narrative-ballroom-intro',
          type: 'narrative',
          text: 'Mingle with guests, gather info, work their way upstairs.'
        },
        {
          id: 'a4-cue-ballroom-map', type: 'vtt-cue',
          label: 'Load Ground Floor Map',
          vtt: { map: 'M03', mode: 'map' }
        },
        {
          id: 'a4-read-ballroom',
          type: 'read-aloud',
          vtt: { scene: 'S13', mode: 'theater' },
          text: 'The ballroom is a cathedral of vanity. Three crystal chandeliers hang from a vaulted ceiling painted with scenes of Waterdhavian conquest \u2014 ships, dragons, men in armor striking heroic poses. Below them, a sea of silk and velvet swirls across a floor of black-and-white marble tile. The string quartet plays on a raised platform near the west windows, framed by curtains of deep crimson. Servants weave through the crowd carrying silver trays of wine and tiny, architectural food \u2014 the kind that looks like a jewel and tastes like a promise.\n\nAt the far end of the ballroom, a grand staircase sweeps upward to the second floor. A single guard stands at the bottom, hands clasped behind his back, watching the crowd with the bored patience of a man who does this every week.'
        },
        {
          id: 'a4-check-ballroom-blend',
          type: 'skill-check',
          check: 'Deception or Performance',
          dc: 13,
          text: 'Blend in with the guests.'
        },
        {
          id: 'a4-check-ballroom-vouch',
          type: 'skill-check',
          check: 'Persuasion',
          dc: 14,
          text: 'Get a noble to vouch for them or distract guards.'
        },
        {
          id: 'a4-check-ballroom-slip',
          type: 'skill-check',
          check: 'Stealth',
          dc: 14,
          text: 'Slip upstairs unnoticed during a toast or performance.'
        },
        {
          id: 'a4-dm-note-martin-ballroom',
          type: 'dm-note',
          title: 'Martin Owns the Ballroom',
          text: 'Martin has +7 Performance \u2014 this is his room. If the party entered via the Performer\u2019s Entrance, he\u2019s already got a reason to be on the stage. Let him own this. Jean\u2019s Knight background means he knows how to hold a wine glass and nod at the right moments, even if his Passive Perception means he\u2019s oblivious to the guard counting heads.'
        },
        {
          id: 'a4-narrative-pemberton-intro',
          type: 'narrative',
          text: 'The Nosy Noble \u2014 Lord Pemberton: Within a few minutes of mingling, a noble approaches whoever looks most out of place (probably L\u00F3m\u00EB or the Rogue, unless they\u2019re well-disguised).'
        },
        {
          id: 'a4-read-pemberton',
          type: 'read-aloud',
          text: 'A portly man in a burgundy doublet waddles over with the unstoppable momentum of someone who has never been told to go away. His face is flushed \u2014 he\u2019s at least four glasses of wine into the evening \u2014 and his smile is the kind that expects you to be delighted by his attention.\n\n\u201CI say! I don\u2019t believe I\u2019ve had the pleasure. Lord Desmond Pemberton. I know everyone, of course \u2014 it\u2019s rather my thing \u2014 and I\u2019m quite certain I don\u2019t know you. Which means you must be terribly interesting, or terribly lost.\u201D\n\nHe laughs at his own joke. It goes on too long.'
        },
        {
          id: 'a4-dm-note-pemberton',
          type: 'dm-note',
          title: 'Handling Lord Pemberton',
          text: 'Pemberton is harmless but loud. He\u2019s a social obstacle, not a threat. The danger is that he draws attention and won\u2019t shut up. A Persuasion DC 12 redirects him (\u201CLord Pemberton, is that Lady Gralhund by the punch bowl? I believe she was looking for you.\u201D). A Performance DC 11 entertains him enough that he becomes an unwitting ally (\u201CYou simply MUST meet Captain Helm \u2014 she\u2019s always so serious, she needs someone like you to liven things up!\u201D \u2014 this is a trap; avoid it). Ignoring him or being rude doesn\u2019t raise Heat, but he\u2019ll loudly complain about the \u201Codd newcomers\u201D within earshot of a guard.'
        },
        {
          id: 'a4-narrative-thessaly-intro',
          type: 'narrative',
          text: 'Lady Thessaly \u2014 The Tipsy Socialite: If players reach the area near the grand staircase, or if they\u2019re looking for an ally, Lady Thessaly finds them. She\u2019s been drinking steadily since the gala began.'
        },
        {
          id: 'a4-read-thessaly',
          type: 'read-aloud',
          text: 'A woman in an emerald gown detaches herself from a cluster of laughing nobles and drifts toward you. She\u2019s striking \u2014 high cheekbones, dark hair pinned with silver combs, the kind of beauty that\u2019s been sharpened by years of smiling at people she despises. She holds her wine glass like a weapon.\n\n\u201CYou look like you\u2019re actually interesting. Do you know how rare that is at one of these things?\u201D\n\nShe takes a long sip of wine and looks you over with an appraiser\u2019s eye.\n\n\u201CI\u2019m Thessaly. Lady Thessaly, technically, though the \u2018Lady\u2019 part is mostly a formality at this point. Aldric \u2014 Lord Veymar, my husband \u2014 is upstairs doing whatever it is he does when he disappears for hours. Probably talking to that box again.\u201D\n\nShe says this lightly, but her jaw tightens.\n\n\u201CHe used to talk to me. Now it\u2019s the box. Always the box. Tell me \u2014 do you find it normal for a grown man to whisper to an object?\u201D'
        },
        {
          id: 'a4-dm-note-thessaly',
          type: 'dm-note',
          title: 'Lady Thessaly \u2014 Bitter Ally',
          text: 'Thessaly is bitter, lonely, and three glasses deep. She\u2019s not an enemy \u2014 she genuinely resents Veymar\u2019s obsession. If treated with sympathy (Persuasion DC 12 or just good RP), she\u2019ll share useful info: the study is on the third floor, Veymar locks himself in every evening, the stairwell is locked, Captain Helm carries the only spare key. She\u2019ll even create a distraction if asked \u2014 but not consciously help them steal from her husband. Frame it as: \u201CShe might drunkenly cause a scene near the staircase guard if someone suggests her husband is ignoring her at his own party.\u201D No check required \u2014 just say the right thing and she\u2019ll do the rest.'
        },
        {
          id: 'a4-conditional-thessaly-compassion',
          type: 'conditional',
          condition: 'If L\u00F3m\u00EB or Jean approach with genuine compassion (not manipulation)',
          outcome: 'Thessaly opens up more \u2014 read the following dialogue.'
        },
        {
          id: 'a4-read-thessaly-opens-up',
          type: 'read-aloud',
          text: 'She stares into her wine for a moment.\n\n\u201CHe wasn\u2019t always like this, you know. Before the box, he was just... eccentric. A collector. Harmless. But ever since that shipwreck haul three months ago \u2014 he doesn\u2019t sleep. He barely eats. His eyes have this...\u201D She trails off. \u201CNever mind. You didn\u2019t come here to listen to a wife complain.\u201D\n\nShe straightens, and the socialite mask snaps back into place.\n\n\u201CMore wine?\u201D'
        },
        {
          id: 'a4-encounter-helm',
          type: 'encounter',
          title: 'Captain Helm Approaches',
          trigger: 'Heat 1+',
          text: 'Captain Dara Helm, head of Veymar\u2019s security, confronts the party directly. This is a serious social threat \u2014 Deception DC 16 to satisfy her.'
        },
        {
          id: 'a4-read-helm',
          type: 'read-aloud',
          text: 'A woman in polished armor cuts through the crowd with the ease of someone who owns the room. She stops directly in front of you. Sharp eyes, close-cropped hair, a jaw that looks like it was carved from the same stone as the estate.\n\n\u201CGood evening. Captain Dara Helm, head of Lord Veymar\u2019s security. I don\u2019t believe we\u2019ve met.\u201D\n\nShe doesn\u2019t extend a hand. She doesn\u2019t smile.\n\n\u201CI make it a point to know every face on the guest list. And yours\u2026 I don\u2019t recall. Perhaps you could remind me \u2014 who extended your invitation?\u201D'
        },
        {
          id: 'a4-check-helm',
          type: 'skill-check',
          check: 'Deception',
          dc: 16,
          text: 'Satisfy Captain Helm\u2019s suspicions. This is a real threat for this party (Martin has only +1 Deception, Jean has +3).'
        },
        {
          id: 'a4-dm-tip-helm-substitutions',
          type: 'dm-tip',
          title: 'Creative Skill Substitutions for Helm',
          text: 'Allow creative skill substitutions if the RP justifies it: Martin could try Performance +7 (\u201CI\u2019m the musical act, darling \u2014 do you need to see my set list?\u201D), Persuasion +5 (\u201CCaptain, there seems to be a commotion near the east entrance\u2026\u201D), or Jean could try Intimidation +6 (\u201CDo you know who I am?\u201D) or Persuasion +6 with his Knight bearing. If Jean uses Conquering Presence (Channel Divinity \u2014 frightened, WIS DC 14) on Helm as a last resort, it\u2019s dramatic and messy (+1 Heat minimum) but unforgettable RP.'
        },
        {
          id: 'a4-read-helm-success',
          type: 'read-aloud',
          text: 'Helm studies you for a long, uncomfortable moment. You can feel her measuring every word you said against whatever mental ledger she keeps. Then she exhales \u2014 not quite a sigh, not quite a dismissal.\n\n\u201CVery well. Enjoy the evening.\u201D\n\nShe turns on her heel and walks away. But you notice she doesn\u2019t go far \u2014 she takes up a position by the west pillar, where she can see the staircase and the ballroom at once. Her eyes find you twice more in the next five minutes.'
        },
        {
          id: 'a4-conditional-helm-failure',
          type: 'conditional',
          condition: 'Failure to satisfy Captain Helm',
          outcome: 'She doesn\u2019t arrest them, but she shadows the party for the rest of the act \u2014 all further Stealth checks in the mansion are made at disadvantage.'
        },
        {
          id: 'a4-read-helm-failure',
          type: 'read-aloud',
          text: 'Helm\u2019s expression doesn\u2019t change. But something behind her eyes shifts \u2014 the way a hawk\u2019s pupils adjust before it dives.\n\n\u201CInteresting. I\u2019ll be keeping an eye on you this evening. I\u2019m sure you understand.\u201D\n\nShe steps back but doesn\u2019t leave. For the rest of the night, every time you glance over your shoulder, she\u2019s there \u2014 by a pillar, at the edge of a doorway, her arms folded, watching.'
        },
        {
          id: 'a4-narrative-nearmiss-stairs-intro',
          type: 'narrative',
          text: 'The Near-Miss \u2014 Slipping Upstairs: When the party tries to reach the second floor via the grand staircase, build the tension.'
        },
        {
          id: 'a4-read-nearmiss-stairs',
          type: 'read-aloud',
          vtt: { scene: 'S17' },
          text: 'The guard at the base of the staircase shifts his weight and cracks his neck. A servant passes between you and him, carrying a tower of champagne glasses. For three seconds \u2014 maybe four \u2014 his view of the staircase is completely blocked.\n\nThis is the window.'
        },
        {
          id: 'a4-check-slip-upstairs',
          type: 'skill-check',
          check: 'Stealth',
          dc: 14,
          text: 'Slip past the guard while his view is blocked.'
        },
        {
          id: 'a4-read-slip-success',
          type: 'read-aloud',
          text: 'You move. The carpet on the stairs swallows your footsteps. The music swells \u2014 a crescendo, perfectly timed, as if the quartet were in on it. By the time the servant passes and the guard\u2019s eyes sweep back to the staircase, you\u2019re already rounding the banister on the second-floor landing, heart hammering, invisible from below.'
        },
        {
          id: 'a4-encounter-ballroom-heat2',
          type: 'encounter',
          title: 'Guard at the Second-Floor Landing',
          trigger: 'Heat 2',
          text: 'Helm has posted a guard at the second-floor landing. Must be dealt with (Stealth DC 16 to sneak past, or combat \u2014 1 Guard).'
        },
        {
          id: 'a4-read-ballroom-heat2',
          type: 'read-aloud',
          text: 'You reach the top of the stairs and your stomach drops. A second guard stands at the landing \u2014 arms folded, back against the wall, positioned to see anyone coming up from either staircase. He wasn\u2019t here before. Someone gave the order.'
        }
      ]
    },
    {
      id: 'act-4-path-b',
      title: 'Path B \u2014 Through the Servants\u2019 Quarters (Stealth)',
      blocks: [
        {
          id: 'a4-narrative-servants-intro',
          type: 'narrative',
          text: 'Use back corridors, the dumbwaiter, and servant passages.'
        },
        {
          id: 'a4-cue-servants-map', type: 'vtt-cue',
          label: 'Load Ground Floor Map',
          vtt: { map: 'M03', mode: 'map' }
        },
        {
          id: 'a4-read-servants-corridors',
          type: 'read-aloud',
          vtt: { scene: 'S14' },
          text: 'The servants\u2019 quarters are a different world from the ballroom \u2014 narrow corridors of bare stone and whitewashed plaster, lit by tallow candles that gutter in the drafts. The air smells of lye soap, boiled linen, and the ever-present undercurrent of roasted meat drifting from the kitchens. You can hear the distant music of the gala through the walls, muffled and strange, like a memory of a party you weren\u2019t invited to.\n\nServants move through these corridors with the practiced speed of people who know they\u2019re invisible \u2014 heads down, trays balanced, voices low. Nobody looks at you. Nobody looks at each other, either.'
        },
        {
          id: 'a4-check-servants-stealth',
          type: 'skill-check',
          check: 'Stealth',
          dc: 13,
          text: 'Avoid servants in the corridors.'
        },
        {
          id: 'a4-check-servants-dumbwaiter',
          type: 'skill-check',
          check: 'Investigation',
          dc: 12,
          text: 'Find the dumbwaiter \u2014 automatic if Pip told them.'
        },
        {
          id: 'a4-dm-note-oda-scout',
          type: 'dm-note',
          title: 'Oda\u2019s Wild Shape for Scouting',
          text: 'Oda\u2019s Wild Shape is ideal for scouting these corridors. A spider on the ceiling or a cat slinking through the shadows draws no suspicion from busy servants. If she scouts ahead, give the party advantage on their first Stealth check down here.'
        },
        {
          id: 'a4-narrative-close-call-intro',
          type: 'narrative',
          text: 'A Close Call \u2014 The Busy Corridor: This is a tension beat. Describe how the party holds their breath. If they\u2019re being loud or careless, make it a Stealth DC 10 (trivial, but the dice roll adds drama). Otherwise, no check required.'
        },
        {
          id: 'a4-read-close-call-corridor',
          type: 'read-aloud',
          vtt: { scene: 'S33' },
          text: 'You\u2019re halfway down the servants\u2019 corridor when a door flies open six feet ahead of you. A young woman in a flour-dusted apron backs through it carrying a massive pot of something steaming. She kicks the door shut with her heel, turns, and walks directly toward you \u2014 head down, muttering a count under her breath.\n\n\u201C...forty-two, forty-three, forty-four \u2014 who orders forty-four crab puffs, honestly...\u201D\n\nShe passes close enough that you can feel the heat rising from the pot. She doesn\u2019t look up. Her shoes squeak on the stone. She rounds the corner and is gone.'
        },
        {
          id: 'a4-encounter-cook',
          type: 'encounter',
          title: 'The Cook Who Spots Them',
          trigger: 'Heat 1+',
          text: 'A broad-shouldered cook confronts the party in the kitchen. Deception DC 14 (\u201CNew hire\u201D) or Intimidation DC 15 (scare them quiet). On failure, she shouts for a guard (+1 Heat) and the party has one round to leave.'
        },
        {
          id: 'a4-read-cook',
          type: 'read-aloud',
          vtt: { scene: 'S30' },
          text: 'The kitchen is a furnace of organized chaos \u2014 three hearths blazing, copper pots clanging, the sizzle of fat and the bark of orders. You\u2019re trying to pass through quickly when a broad-shouldered woman in a grease-stained apron wheels around from the main stove and freezes. She\u2019s holding a cleaver in one hand and a half-butchered duck in the other. Her eyes narrow.\n\n\u201COi. You.\u201D\n\nShe points the cleaver at you. Not threateningly \u2014 more like a teacher who\u2019s caught someone in the wrong classroom.\n\n\u201CI know every face that works this kitchen, and yours isn\u2019t one of them. You new? Because if you\u2019re new, nobody told me, and if nobody told me, you\u2019re not supposed to be here.\u201D'
        },
        {
          id: 'a4-check-cook-deception',
          type: 'skill-check',
          check: 'Deception',
          dc: 14,
          text: 'Convince the cook you\u2019re a new hire.'
        },
        {
          id: 'a4-read-cook-deception-success',
          type: 'read-aloud',
          text: 'She squints at you for a long moment, then grunts.\n\n\u201CNew hire. Of course. Nobody tells me anything. Lord\u2019s paying for a forty-plate dinner and they send me one warm body at the last minute with no training.\u201D She shoves a tray of bread rolls into your hands. \u201CMake yourself useful. Take those to the dining hall. And if you drop a single one, you\u2019re scrubbing pots until dawn.\u201D\n\nShe\u2019s already turned back to the stove before you can respond. The tray gives you perfect cover to cross the kitchen.'
        },
        {
          id: 'a4-check-cook-intimidation',
          type: 'skill-check',
          check: 'Intimidation',
          dc: 15,
          text: 'Scare the cook into silence.'
        },
        {
          id: 'a4-read-cook-intimidation-success',
          type: 'read-aloud',
          text: 'She takes a half-step back, and the cleaver lowers an inch. Her mouth opens, closes. She glances at the door to the corridor, then back at you.\n\n\u201CRight. None of my business. I didn\u2019t see anything.\u201D She turns back to her stove with exaggerated focus. \u201CJust... don\u2019t touch the wine. He counts the bottles.\u201D'
        },
        {
          id: 'a4-conditional-cook-failure',
          type: 'conditional',
          condition: 'Failure on both Deception and Intimidation',
          outcome: 'She shouts for a guard. +1 Heat. The party has one round to leave the kitchen before a guard arrives.'
        },
        {
          id: 'a4-narrative-dumbwaiter-intro',
          type: 'narrative',
          text: 'The Dumbwaiter: The dumbwaiter goes to the second floor only \u2014 they still need to get to the third. It can carry one Small creature comfortably or one Medium creature uncomfortably (Acrobatics DC 10 to squeeze in). The crank is loud \u2014 Stealth DC 13 while operating it, or stuff cloth around the pulleys to muffle it (no check, but takes an extra minute).'
        },
        {
          id: 'a4-read-dumbwaiter',
          type: 'read-aloud',
          text: 'You find it behind a stack of flour sacks in the back pantry \u2014 a wooden shaft barely two feet square, with a hand-crank mechanism and a frayed rope that disappears into the darkness above. The wood is old, the pulleys are rusty, and when you look up the shaft, you can see the faint outline of the second-floor hatch ten feet above you.\n\nSomething scurries in the darkness up there. Probably a rat. Hopefully a rat.'
        },
        {
          id: 'a4-encounter-servants-heat2',
          type: 'encounter',
          title: 'Servants on Alert',
          trigger: 'Heat 2',
          text: 'Servants have been told to watch for intruders. All Stealth DCs +2.'
        },
        {
          id: 'a4-read-servants-heat2',
          type: 'read-aloud',
          text: 'Something has changed. The servants are moving differently \u2014 checking over their shoulders, whispering in pairs, glancing at faces instead of floors. A steward you haven\u2019t seen before is walking the corridor with a lantern, opening doors and peering into rooms.\n\nSomeone gave the order. They\u2019re looking for you.'
        },
        {
          id: 'a4-narrative-nervous-servant-intro',
          type: 'narrative',
          text: 'A Close Call \u2014 The Nervous Servant: On the second floor, as the party navigates toward the third-floor stairwell. This is a tension beat \u2014 let it happen naturally.'
        },
        {
          id: 'a4-read-nervous-servant',
          type: 'read-aloud',
          text: 'You flatten against the wall as footsteps approach \u2014 quick, nervous steps, someone trying to be thorough rather than quiet. A young man in house livery appears at the end of the corridor, carrying a ring of keys. He stops at each door, unlocks it, peers inside for exactly three seconds, then relocks it and moves on.\n\nHe\u2019s two doors away from you. One door. He reaches for the handle of the room you\u2019re standing next to.\n\nThen \u2014 from downstairs \u2014 a crash. Glass breaking. Someone in the ballroom shouts, and then laughter erupts. The servant flinches, looks toward the staircase, and mutters: \u201CLord save me, if that\u2019s another chandelier...\u201D\n\nHe pockets the keys and hurries toward the noise. The corridor is empty again.'
        },
        {
          id: 'a4-dm-note-nervous-servant',
          type: 'dm-note',
          title: 'The Crash \u2014 Rewarding Player Foresight',
          text: 'This is a gift \u2014 let it happen naturally. If the players set up a distraction earlier (Lady Thessaly, Martin performing, etc.), credit their foresight. If not, it\u2019s just lucky timing. Either way, the tension of the approaching footsteps followed by the relief of the crash gives the players a visceral sense that this heist is alive and unpredictable.'
        }
      ]
    },
    {
      id: 'act-4-path-c',
      title: 'Path C \u2014 Outside Route (Acrobatic)',
      blocks: [
        {
          id: 'a4-narrative-outside-intro',
          type: 'narrative',
          text: 'Scale balconies and rooftops to reach the third-floor balcony directly.'
        },
        {
          id: 'a4-cue-outside-map', type: 'vtt-cue',
          label: 'Load Second Floor Map',
          vtt: { map: 'M04', mode: 'map' }
        },
        {
          id: 'a4-read-outside-rooftop',
          type: 'read-aloud',
          vtt: { scene: 'S15' },
          text: 'The night air hits you like cold water after the warmth of the estate. Above, a half-moon hangs in a sky streaked with thin clouds. Below, the gardens are dark \u2014 hedge rows and gravel paths silvered with moonlight. Somewhere down there, a mastiff whines and is shushed by its handler.\n\nThe second-floor balcony is twelve feet above you \u2014 weathered stone with iron railings, the kind of balcony that exists so wealthy people can stare at their own gardens. Beyond it, the rooftop stretches toward the third floor like a tilted field of dark slate tiles. From up here, you can see the third-floor balcony \u2014 a narrow ledge of stone railing and a glass door, maybe forty feet along the roofline.\n\nThe wind picks up. A tile somewhere above shifts and clicks against its neighbor.'
        },
        {
          id: 'a4-check-outside-climb',
          type: 'skill-check',
          check: 'Athletics',
          dc: 14,
          text: 'Climb to the second-floor balcony.'
        },
        {
          id: 'a4-read-climb-success',
          type: 'read-aloud',
          text: 'Your fingers find the cracks between the stones \u2014 old mortar, crumbling in places, solid enough in others. You pull yourself up hand over hand, boots scraping against ivy that tears away in strips beneath your weight. For one bad moment, your foot slips and you swing by your fingers, dangling twelve feet above the gravel path. Then your hand finds the iron railing and you haul yourself over, landing on the balcony in a crouch.\n\nBelow, a guard walks past on the garden path. He doesn\u2019t look up. People never look up.'
        },
        {
          id: 'a4-conditional-climb-failure',
          type: 'conditional',
          condition: 'Failure on Athletics DC 14 to climb',
          outcome: 'Fall and take 1d6 bludgeoning damage. Must retry or find another way. The noise may attract attention (Stealth DC 12 to stay quiet on impact, or +1 Heat).'
        },
        {
          id: 'a4-check-outside-traverse',
          type: 'skill-check',
          check: 'Acrobatics',
          dc: 15,
          text: 'Traverse the rooftop to the third-floor balcony.'
        },
        {
          id: 'a4-read-rooftop-crossing',
          type: 'read-aloud',
          text: 'The rooftop is a nightmare of angles. Slate tiles slick with evening dew, pitched at a grade steep enough that every step wants to become a slide. The wind is stronger up here \u2014 it tugs at your clothes, pushes at your balance, carries the muffled sound of the gala below like music from another life. The third-floor balcony waits at the far end, a dark rectangle against the pale stone.\n\nBetween you and it: forty feet of tilted roof, a chimney stack, and the certain knowledge that a fall from this height will be loud, painful, and extremely difficult to explain.'
        },
        {
          id: 'a4-read-traverse-success',
          type: 'read-aloud',
          text: 'You move in a low crouch, weight on your toes, fingers trailing against the tiles for balance. Each step is deliberate \u2014 test the tile, shift your weight, move. The chimney stack gives you a handhold at the halfway point, and you press your back against the warm brick and breathe. The city stretches below you \u2014 the Sea District\u2019s lamplit streets, the distant dark smudge of the harbor, the faint sound of the gala drifting up from below like a dream.\n\nThen you push off and cover the last twenty feet to the third-floor balcony. Your hands close around the stone railing and you pull yourself over, landing softly on the narrow ledge. The glass door is right there \u2014 dark, quiet, waiting.'
        },
        {
          id: 'a4-check-outside-stealth',
          type: 'skill-check',
          check: 'Stealth',
          dc: 14,
          text: 'Avoid the rooftop archer while crossing.'
        },
        {
          id: 'a4-encounter-archer',
          type: 'encounter',
          title: 'The Rooftop Archer',
          trigger: 'Heat 1+',
          text: 'A sentry with a crossbow on the east tower platform. Must be avoided (Stealth DC 16) or neutralized quietly (melee attack, grapple, Sleep spell, etc.).'
        },
        {
          id: 'a4-read-archer',
          type: 'read-aloud',
          text: 'You hear him before you see him \u2014 a low, tuneless humming drifting from the east tower platform, twenty feet above and to your right. A man in leather armor sits on the tower\u2019s parapet, crossbow across his knees, staring out at the harbor. He\u2019s not paying attention. He\u2019s counting stars, or thinking about his dinner, or whatever bored sentries think about on nights when nothing ever happens.\n\nThen he shifts, stretching his neck, and his gaze begins to sweep the roofline.'
        },
        {
          id: 'a4-dm-note-archer',
          type: 'dm-note',
          title: 'Archer Encounter \u2014 Party Strengths',
          text: 'If Oda Wild Shapes into a cat or owl and crosses the rooftop, the archer won\u2019t think twice \u2014 animals on the roof are normal. She can potentially scout the route or even distract the archer while others cross. If the Rogue is on this path, Stealth expertise should make DC 16 manageable. The real tension is anyone with lower Stealth (Jean at +0 should NOT be on this path \u2014 but if he insists, make the dice roll dramatic).'
        },
        {
          id: 'a4-read-archer-dialogue',
          type: 'read-aloud',
          text: 'The archer, if the party observes him for a moment:\n\nHe lifts a wineskin, takes a pull, and mutters to himself.\n\n\u201C\u2018Watch the roof,\u2019 she says. \u2018Possible threat from above,\u2019 she says. What\u2019s going to come from above? A very ambitious seagull?\u201D\n\nHe takes another drink and goes back to staring at the harbor.'
        },
        {
          id: 'a4-encounter-outside-heat2',
          type: 'encounter',
          title: 'Arcane Lights on the Rooftop',
          trigger: 'Heat 2',
          text: 'The rooftop is magically lit. Stealth checks made at disadvantage unless they dispel or destroy the light source.'
        },
        {
          id: 'a4-read-outside-heat2',
          type: 'read-aloud',
          text: 'The rooftop floods with cold blue light. Arcane lanterns \u2014 four of them, mounted at the corners of the roof ridge \u2014 flare to life simultaneously, turning the dark slate into a stage. Every shadow vanishes. Every tile is visible. You feel as exposed as an insect on a dinner plate.\n\nFrom the east tower, you hear the archer stand up. He\u2019s not humming anymore.'
        },
        {
          id: 'a4-dm-note-heat2-lights',
          type: 'dm-note',
          title: 'Dealing with Arcane Lights',
          text: 'The light source can be destroyed (AC 10, 5 HP each, but shattering one is audible), dispelled (Dispel Magic, DC 13 \u2014 Martin auto-succeeds), or avoided by timing movement between the lanterns\u2019 positions (Stealth DC 18 \u2014 the light is thorough but the chimney stack creates a narrow shadow corridor).'
        }
      ]
    },
    {
      id: 'act-4-stairwell',
      title: 'The Third-Floor Stairwell Door',
      blocks: [
        {
          id: 'a4-dm-note-jean-weapons',
          type: 'dm-note',
          title: 'Jean\u2019s Weapons Inside the Mansion',
          text: 'Note on Jean\u2019s weapons: His Warhorse and Mounted Combatant feat are useless inside the mansion. His lance has disadvantage within 5 ft without a mount. Inside, Jean fights with his warhammer (+6 to hit, 1d8+3 bludgeoning, Push mastery). Save the mount for the warehouse fight in Act 6 (60 ft x 40 ft \u2014 tight but possible).'
        },
        {
          id: 'a4-narrative-stairwell-intro',
          type: 'narrative',
          text: 'However they get to the second floor, they face the locked stairwell door (unless they came via the outside balcony route, which bypasses it entirely).'
        },
        {
          id: 'a4-cue-stairwell-map', type: 'vtt-cue',
          label: 'Load Second Floor Map',
          vtt: { map: 'M04', mode: 'map' }
        },
        {
          id: 'a4-read-stairwell-approach',
          type: 'read-aloud',
          text: 'The second-floor corridor narrows as you move away from the guest rooms and toward the back of the house. The carpet thins, then disappears entirely. The wallpaper changes \u2014 from silk damask to bare plaster. The gala is a distant murmur now, two floors and a world away.\n\nAt the end of the corridor, set into an alcove lit by a single guttering candle, is a heavy oak door reinforced with iron bands. A brass lock \u2014 newer than the door, recently installed \u2014 gleams in the candlelight. Beyond this door, a narrow staircase leads up to the third floor.\n\nFrom somewhere below, you hear footsteps. A patrol, maybe. Or a servant. Or nothing. But the sound reminds you: you\u2019re standing in the open, in a corridor with one way in and one way out, trying to open a door that someone very much does not want you to open.'
        },
        {
          id: 'a4-check-stairwell-pick',
          type: 'skill-check',
          check: 'Thieves\u2019 Tools',
          dc: 15,
          text: 'Pick the lock on the stairwell door.'
        },
        {
          id: 'a4-narrative-stairwell-alternatives',
          type: 'narrative',
          text: 'Alternative methods: Knock or Dispel Magic opens it automatically (but Knock is audible within 300 ft \u2014 it will be heard, instant +1 Heat). Captain Helm\u2019s key (pickpocketed: Sleight of Hand DC 17, or looted if she was knocked out). Strength DC 20 to force it (loud \u2014 +1 Heat).'
        },
        {
          id: 'a4-check-stairwell-pickpocket',
          type: 'skill-check',
          check: 'Sleight of Hand',
          dc: 17,
          text: 'Pickpocket Captain Helm\u2019s key (or looted if she was knocked out).'
        },
        {
          id: 'a4-check-stairwell-force',
          type: 'skill-check',
          check: 'Strength',
          dc: 20,
          text: 'Force the door open (loud \u2014 +1 Heat).'
        },
        {
          id: 'a4-dm-note-stairwell-lock',
          type: 'dm-note',
          title: 'Lock-Picking Difficulty and Options',
          text: 'The Rogue with Thieves\u2019 Tools expertise likely has +9 or more \u2014 DC 15 is manageable but not guaranteed. If they bought Knuckles\u2019 masterwork tools (+2), this becomes almost trivial. If they don\u2019t have the Rogue here (bad party split), this is a real problem. Martin\u2019s Knock spell works but announces their presence to every guard within 300 feet. Build the tension \u2014 describe the sound of those footsteps below getting closer while the lock is being worked.'
        },
        {
          id: 'a4-narrative-lockpick-tension-intro',
          type: 'narrative',
          text: 'Picking the Lock \u2014 The Tension Beat: Read the following while the Rogue works the lock.'
        },
        {
          id: 'a4-read-lockpick-tension',
          type: 'read-aloud',
          text: 'The pick slides into the lock. The first tumbler clicks \u2014 loud in the silence \u2014 and you freeze. Nothing. No shout, no footsteps. You exhale and go back to work.\n\nThe second tumbler resists. You can feel it catching on something \u2014 a false groove, the kind a locksmith adds to frustrate exactly this kind of thing. The footsteps below are getting louder. Someone is coming up the main staircase.\n\nThe third tumbler. Your fingers are steady but your pulse isn\u2019t. The footsteps reach the second-floor landing. A voice \u2014 a guard, calling to someone: \u201CAnything up here?\u201D\n\nClick.'
        },
        {
          id: 'a4-read-lockpick-success',
          type: 'read-aloud',
          text: 'The lock turns. The door swings inward on oiled hinges \u2014 someone keeps this door well-maintained, even if they never want it opened. Beyond, a narrow staircase spirals upward into darkness.\n\nBehind you, the guard\u2019s voice again, closer: \u201CNo? Right. Check the library.\u201D Footsteps recede. You slip through the door and pull it shut behind you.\n\nYou\u2019re through.'
        },
        {
          id: 'a4-conditional-lockpick-failure',
          type: 'conditional',
          condition: 'Failure on Thieves\u2019 Tools DC 15',
          outcome: 'The lock doesn\u2019t budge. They can retry (takes another minute \u2014 roll again, but the patrol is closer) or find another way. Each retry increases the chance of discovery \u2014 after two failures, a guard rounds the corner unless the party has set up a distraction.'
        }
      ]
    },
    {
      id: 'act-4-transition',
      title: 'Transition to the Third Floor',
      blocks: [
        {
          id: 'a4-narrative-transition-intro',
          type: 'narrative',
          text: 'Whether they came through the stairwell door or the outside balcony, read this when they reach the third floor.'
        },
        {
          id: 'a4-cue-thirdfloor-map', type: 'vtt-cue',
          label: 'Load Third Floor Map',
          vtt: { map: 'M05', mode: 'map' }
        },
        {
          id: 'a4-read-third-floor',
          type: 'read-aloud',
          vtt: { scene: 'S16' },
          text: 'The third floor is different.\n\nYou feel it the moment you step off the stairs \u2014 or over the balcony railing \u2014 and your feet touch the floorboards. The air is cooler here, and still, as if the gala below is happening in a different building entirely. The hallway is narrow, lit by a single arcane sconce that burns with a pale, steady blue flame that doesn\u2019t flicker. No drafts. No sound. The walls are bare stone \u2014 no wallpaper, no paintings, no pretense of domesticity. This is not a place where guests are welcomed.\n\nThe floorboards are dark hardwood, old and smooth, and they creak faintly under your weight. Three doors line the hallway: one to the left (the private gallery), one to the right (the arcane workshop), and one at the far end, directly ahead \u2014 a heavy oak door with iron fittings and, you notice, faint lines of light tracing the edges of the frame.\n\nThe study.\n\nThe air smells of old paper, candle wax, and something else \u2014 something metallic and sharp, like the air before a lightning storm. Whatever Lord Veymar has been doing up here, alone, night after night, the room remembers it.'
        },
        {
          id: 'a4-dm-note-transition-moment',
          type: 'dm-note',
          title: 'Let the Players Breathe',
          text: 'Give the players a moment here. They\u2019ve been navigating tension and crowds and near-misses for the last twenty minutes. This silence is earned \u2014 and unsettling. The contrast between the noisy, golden gala below and this cold, quiet floor should feel wrong. Something is off about the third floor. Something has been off for three months, ever since Veymar brought the box home. Let them feel it before they open the study door and move into Act 5.'
        }
      ]
    }
  ]
},
{
  id: 'act-5', number: 5, title: 'Retrieving the Puzzle Box', duration: '~15-20 min',
  sections: [
    {
      id: 'act-5-approach', title: 'Approach to the Study',
      blocks: [
        {
          id: 'a5-read-approach', type: 'read-aloud',
          vtt: { scene: 'S18', mode: 'theater', titleCard: 5 },
          text: 'The staircase to the third floor is narrower than the ones below \u2014 older, too. The carpet thins out, the wallpaper darkens from cream to a deep, bruised burgundy. The noise of the gala drops away with every step, replaced by a silence that feels deliberate, like the house itself is holding its breath. The air up here is different \u2014 cooler, drier, and carrying a faint metallic taste at the back of your throat, like the moment before a lightning strike.\n\nThe hallway stretches ahead of you, lit by a single oil lamp on a wall sconce that barely pushes back the dark. Closed doors on either side. At the far end \u2014 the study. Even from here, you can see the door is heavier than the others. Reinforced oak, iron banding. The kind of door that says: this room matters.'
        },
        {
          id: 'a5-dm-approach-pacing', type: 'dm-note',
          title: 'Let the Silence Land',
          text: 'Give the players a moment here. This is the first time the gala noise has completely vanished. Let them feel the quiet. If anyone asks about the other doors \u2014 they\'re locked guest rooms and storage, nothing useful. The study is straight ahead.'
        }
      ]
    },
    {
      id: 'act-5-ward', title: 'The Arcane Ward',
      blocks: [
        {
          id: 'a5-narrative-ward-intro', type: 'narrative',
          text: 'The study door has an Arcane Ward (if the players learned about this from Lord Thorne, they\'re prepared; if not, it\'s a surprise).'
        },
        {
          id: 'a5-check-ward-detect', type: 'skill-check',
          check: 'Arcana (or Detect Magic)', dc: 14,
          text: 'Detect the ward. Three casters have Detect Magic (Martin, L\u00f3m\u00eb, Oda) \u2014 this will be spotted. That\'s OK; it rewards preparation.'
        },
        {
          id: 'a5-read-ward-detected', type: 'read-aloud',
          text: 'The moment you extend your senses toward the door, you see it \u2014 a lattice of pale blue-white threads woven across the door frame like a spider\'s web made of starlight. The lines pulse faintly, rhythmically, like a heartbeat. The magic is dense and layered \u2014 not crude alarm work, but something designed by someone who understood the craft. At the center of the web, just above the door frame, a small rune stone is set into the wall, almost invisible unless you know to look. That\'s the anchor.'
        },
        {
          id: 'a5-dm-ward-no-check', type: 'dm-note',
          title: 'If Nobody Checks the Door',
          text: 'If nobody checks and they just try the door, the ward is invisible to the naked eye. They trigger it with no warning.'
        },
        {
          id: 'a5-dm-ward-bypass', type: 'dm-note',
          title: 'Arcane Ward Bypass Options',
          text: 'Bypass options: Dispel Magic (DC 13 \u2014 Martin auto-succeeds), Thieves\' Tools DC 16 (the ward has a physical anchor \u2014 a rune stone above the door frame; the Rogue likely auto-passes with expertise), or Arcana DC 16 (carefully unravel the enchantment).'
        },
        {
          id: 'a5-read-bypass-dispel', type: 'read-aloud',
          text: 'Martin speaks the counterspell and the threads of light shiver, contract, and dissolve like frost in sunlight. The rune stone above the door frame cracks down the middle with a soft tick \u2014 barely louder than a fingernail against glass. The door is just a door now. The hallway exhales.'
        },
        {
          id: 'a5-read-bypass-thieves', type: 'read-aloud',
          text: 'The Rogue reaches up, tools in hand, and works the rune stone loose from the wall with surgical precision \u2014 a twist, a scrape, a final careful pull. The stone comes free trailing a wisp of fading light like smoke from a blown-out candle. The web unravels from the edges inward, and in three seconds, the ward is gone. Clean work.'
        },
        {
          id: 'a5-read-bypass-arcana', type: 'read-aloud',
          text: 'You press your hands close to the web of light \u2014 not touching, never touching \u2014 and begin teasing the strands apart, redirecting the flow of magic back into the rune stone until it overloads and goes dark. It\'s like defusing a bomb made of thought. The last thread snaps, and the doorway clears.'
        },
        {
          id: 'a5-conditional-ward-trigger', type: 'conditional',
          condition: 'They open the door without bypassing the ward',
          outcome: 'A silent Alarm spell notifies Veymar. He will arrive in 3 rounds with 2 Guards. +1 Heat (or instant to Heat 2 if not already).'
        },
        {
          id: 'a5-read-ward-triggered', type: 'read-aloud',
          text: 'The moment the door opens, the lattice of invisible threads collapses inward \u2014 and for a single heartbeat, you feel it: a pulse of magic that passes through you like a cold wind, outward and downward, through the floors, through the walls, aimed at something \u2014 someone \u2014 below. There\'s no sound. No flash of light. Nothing visible at all. But every caster in the group feels their skin prickle with the unmistakable sensation of a message being sent.\n\nSomeone downstairs just found out you\'re here.'
        },
        {
          id: 'a5-dm-ward-triggered-dread', type: 'dm-note',
          title: 'Build the Dread After Trigger',
          text: 'Don\'t tell them explicitly that Veymar is coming. Let them feel the dread. Start a mental 3-round timer. If they\'re fast, they can grab the box and go. If they dawdle, Veymar arrives at the study door with guards.'
        }
      ]
    },
    {
      id: 'act-5-study', title: 'The Study',
      blocks: [
        {
          id: 'a5-read-study', type: 'read-aloud',
          vtt: { scene: 'S19' },
          text: 'The door opens onto a room that smells of old ink and ozone. Lord Veymar\'s study is lined floor to ceiling with bookshelves, the spines of the books stamped in silver and gold. A heavy oak desk dominates the center, scattered with star charts and arcane diagrams. On the far wall, between two tall windows draped in deep blue curtains, sits a glass display case on an iron pedestal. Inside it, catching the moonlight, is the puzzle box \u2014 a cube no larger than a fist, its surface covered in shifting geometric patterns that seem to move when you\'re not looking directly at them.'
        },
        {
          id: 'a5-dm-study-pacing', type: 'dm-note',
          title: 'Let Them Explore the Room',
          text: 'Resist the urge to funnel the party straight to the box. Let them look around first. Someone will want to check the desk, the bookshelves, the windows. Give them a beat to explore \u2014 this is Veymar\'s inner sanctum and it should feel like it. The star charts are real (astrology and planar conjunctions). The books are mostly arcane theory and history. Nothing immediately useful, but it rewards curiosity and makes the room feel lived-in. When attention naturally drifts to the display case, that\'s when the scene tightens.'
        }
      ]
    },
    {
      id: 'act-5-getting-box', title: 'Getting the Box',
      blocks: [
        {
          id: 'a5-narrative-option-a', type: 'narrative',
          text: 'Option A \u2014 The Glass Display Case (Default): The box sits in a glass case on an iron pedestal.'
        },
        {
          id: 'a5-read-display-case', type: 'read-aloud',
          vtt: { scene: 'S20' },
          text: 'The display case is simple \u2014 clear glass on an iron frame, no lock. The box sits on a velvet cushion inside, perfectly centered. It looks easy. It looks like you could just reach in and take it.'
        },
        {
          id: 'a5-dm-trap', type: 'dm-note',
          title: 'Pressure-Sensitive Pedestal Trap',
          text: 'The pedestal is pressure-sensitive. Removing the box without disabling the mechanism triggers a Glyph of Warding (3d8 thunder damage, DC 14 Dex save for half, VERY LOUD \u2014 instant Heat 2).'
        },
        {
          id: 'a5-check-trap-spot', type: 'skill-check',
          check: 'Investigation', dc: 14,
          text: 'Spot the pressure mechanism (the Rogue\'s moment).'
        },
        {
          id: 'a5-read-trap-discovered', type: 'read-aloud',
          text: 'You lean in close \u2014 not touching, just looking. And you see it. The velvet cushion sits slightly lower than it should, compressed by the weight of the box. Beneath the cushion, through the glass base, you can just make out a thin copper plate \u2014 a pressure switch. And etched into the underside of that plate, a glyph. You\'ve seen this kind of work before. Lift the box without counterweight, and the plate rises. The glyph fires. Everyone in this room has a very bad night.'
        },
        {
          id: 'a5-check-trap-disable', type: 'skill-check',
          check: 'Thieves\' Tools', dc: 15,
          text: 'Disable the pressure mechanism (likely trivial for the Rogue with expertise).'
        },
        {
          id: 'a5-check-trap-swap', type: 'skill-check',
          check: 'Sleight of Hand', dc: 15,
          text: 'Swap the box\'s weight with something equivalent (~2 lbs). Requires Investigation DC 14 to spot the mechanism first.'
        },
        {
          id: 'a5-dm-tip-rogue', type: 'dm-tip',
          title: 'Make Sure the Rogue Is Here',
          text: 'If the Rogue isn\'t here (bad party split), it falls to Martin (Investigation +4, Sleight of Hand +3 \u2014 risky). Make sure the Rogue is on the infiltration team, not the social team.'
        },
        {
          id: 'a5-read-moment-of-taking', type: 'read-aloud',
          vtt: { scene: 'S21' },
          text: 'The glass case opens silently. Your hand closes around the puzzle box and \u2014 it\'s warm. Not like something left in the sun. Warm like something alive. The geometric patterns on its surface shift under your fingers, adjusting, rearranging, as if the box is aware it\'s been moved. It weighs almost nothing. It feels like holding a clenched fist.\n\nThe pedestal stays flat. The glyph stays dark. You have it.'
        },
        {
          id: 'a5-read-heist-swap', type: 'read-aloud',
          text: 'One hand on the box. The other holding the counterweight \u2014 [whatever the player chose]. You breathe in. You breathe out. And in a single fluid motion, you make the swap. Box up. Weight down. The copper plate doesn\'t move. The glyph doesn\'t fire. The room stays silent.\n\nFor one perfect second, you\'re the best thief in Waterdeep.'
        },
        {
          id: 'a5-dm-swap-counterweight', type: 'dm-note',
          title: 'Let the Rogue Choose Their Counterweight',
          text: 'If the Rogue does the swap, let them describe what they use as counterweight. A wine bottle from downstairs, a heavy book from the shelf, a bag of coins \u2014 whatever they pick, say yes and let them have the moment. This is their set piece.'
        },
        {
          id: 'a5-conditional-brute-force', type: 'conditional',
          condition: 'Smash the case (AC 13, 3 HP)',
          outcome: 'Triggers the Glyph of Warding.'
        },
        {
          id: 'a5-read-trap-triggered', type: 'read-aloud',
          text: 'The copper plate snaps upward. The glyph blazes white-hot. And the world becomes sound \u2014 a concussive boom of raw thunder that blows the glass case apart, sends books tumbling from shelves, and slams through your chest like a fist. The windows rattle in their frames. Dust falls from the ceiling. Your ears are ringing \u2014 and below you, through the floorboards, you can hear shouting. A lot of shouting.'
        },
        {
          id: 'a5-dm-trap-damage', type: 'dm-note',
          title: 'Trap Damage and Heat',
          text: '3d8 thunder damage, DC 14 Dex save for half. Instant Heat 2. Every guard in the estate heard that.'
        },
        {
          id: 'a5-narrative-option-b', type: 'narrative',
          text: 'Option B \u2014 Veymar Has It On Him (Alternative): If the players got specific intel suggesting Veymar keeps it close (or if you want an alternate challenge), the box is in his breast pocket during the gala.'
        },
        {
          id: 'a5-read-veymar-pocket', type: 'read-aloud',
          text: 'You spot Veymar near the far end of the ballroom, holding a glass of wine he hasn\'t touched, listening to a conversation he clearly finds tedious. Every few minutes, his free hand drifts to his breast pocket \u2014 a quick touch, barely conscious, the way a man checks that his coin purse is still there. Whatever he\'s carrying, he doesn\'t want to be more than an arm\'s reach from it.'
        },
        {
          id: 'a5-check-pickpocket', type: 'skill-check',
          check: 'Sleight of Hand', dc: 18,
          text: 'Pickpocket the box from Veymar (he\'s paranoid and alert).'
        },
        {
          id: 'a5-conditional-distraction', type: 'conditional',
          condition: 'Create a scene (Lady Thessaly can help if befriended)',
          outcome: 'Pickpocket DC drops to 14.'
        },
        {
          id: 'a5-check-confrontation', type: 'skill-check',
          check: 'Intimidation', dc: 18,
          text: 'Corner Veymar privately and intimidate him into surrendering the box (or combat \u2014 use Noble stat block with 2 Guards).'
        },
        {
          id: 'a5-read-veymar-confrontation', type: 'read-aloud',
          text: 'Veymar\'s composure doesn\'t break \u2014 it freezes. His hand closes around the shape in his pocket and his eyes go flat and hard.\n\n\u201cDo you have any idea what you\'re trying to steal? Do you even know what it is?\u201d He shakes his head slowly, the way you\'d look at a child reaching for a hot stove. \u201cThis isn\'t treasure. This isn\'t some trinket. Whoever sent you \u2014 whoever told you to take this \u2014 they didn\'t tell you the truth. They couldn\'t have. Because if you knew what this box was, you would be running in the other direction.\u201d\n\nHis voice drops to a whisper.\n\n\u201cI am trying to keep it safe. I am the only one keeping it safe. And you\'re going to walk in here and just \u2014 take it? For money?\u201d'
        },
        {
          id: 'a5-dm-veymar-genuine', type: 'dm-note',
          title: 'Veymar Is Telling the Truth',
          text: 'This is genuine. Veymar is paranoid and arrogant, but he\'s not wrong about the box. If players hesitate, let them \u2014 it creates dramatic tension. But the job is the job. They can wrestle with it after.'
        }
      ]
    },
    {
      id: 'act-5-examining', title: 'Examining the Box',
      blocks: [
        {
          id: 'a5-narrative-examining-intro', type: 'narrative',
          text: 'Once they have it, players may want to inspect it. Let them. This is the foreshadowing payoff for the entire adventure \u2014 don\'t rush it.'
        },
        {
          id: 'a5-cue-thirdfloor-map', type: 'vtt-cue',
          label: 'Return to Third Floor Map',
          vtt: { map: 'M05', mode: 'map' }
        },
        {
          id: 'a5-check-arcana-14', type: 'skill-check',
          check: 'Arcana', dc: 14,
          text: 'The box radiates overwhelming abjuration and evocation magic \u2014 far more powerful than anything Lord Veymar could create. The seal is not mechanical \u2014 it\'s blood magic, ancient and primal.'
        },
        {
          id: 'a5-read-arcana-14', type: 'read-aloud',
          text: 'You pass your hand over the surface of the box, reaching out with your arcane senses, and the response nearly staggers you. Magic pours off this thing like heat from a forge \u2014 dense, layered, ancient. Abjuration and evocation magic, intertwined so tightly they\'re almost indistinguishable. The seal is not mechanical \u2014 it\'s blood magic, old and primal, the kind that predates modern spellcraft by centuries. Whatever Veymar thought he had in his study, he had no idea. This is beyond him. This is beyond anyone you\'ve ever met.'
        },
        {
          id: 'a5-check-arcana-18', type: 'skill-check',
          check: 'Arcana', dc: 18,
          text: 'The seal requires a specific ritual to break. Something about \u201cfive lives freely given\u2026 or freely taken.\u201d The magic inside the box feels like standing at the edge of a furnace \u2014 not fire, but annihilation. Whatever is inside was not made by mortal hands.'
        },
        {
          id: 'a5-read-arcana-18', type: 'read-aloud',
          text: 'You push deeper \u2014 and immediately wish you hadn\'t. The magic inside the box isn\'t just powerful. It\'s hungry. It feels like standing at the edge of a furnace that burns with something worse than fire \u2014 not heat, but annihilation. Unmaking. The seal holding it shut is a ritual \u2014 you can feel the shape of it. Five points of contact. Five anchors. And the key\u2026 \u201cfive lives freely given\u2026 or freely taken.\u201d The magic inside the box shifts, as if it knows you\'re listening.'
        },
        {
          id: 'a5-check-religion-16', type: 'skill-check',
          check: 'Religion', dc: 16,
          text: 'The symbols are not from any one tradition \u2014 they\'re older. A character trained in Religion recognizes fragments: iconography associated with divine weapons of destruction, the kind wielded by gods to end ages. Whatever\'s inside was meant to stay inside \u2014 not to protect the box, but to protect the world.'
        },
        {
          id: 'a5-read-religion-16', type: 'read-aloud',
          text: 'The symbols on the box click into focus \u2014 not all at once, but in fragments. You recognize pieces from a dozen different traditions, but the roots are older than any of them. These are divine marks. Not the blessings of clerics or the wards of temples \u2014 these are the kind of symbols carved into the foundations of the world by the gods themselves. Iconography associated with weapons of divine destruction. The kind wielded by gods to end ages.\n\nWhatever is inside this box was meant to stay inside \u2014 not to protect the box, but to protect the world from what it contains.'
        },
        {
          id: 'a5-dm-lome-advantage', type: 'dm-note',
          title: 'L\u00f3m\u00eb\'s Kelemvor Advantage on Religion',
          text: 'If L\u00f3m\u00eb makes this check, grant advantage \u2014 a follower of the god of the dead recognizes sealed-soul iconography more readily than most.'
        },
        {
          id: 'a5-read-lome-kelemvor', type: 'read-aloud',
          text: 'The recognition hits you like a bell struck in an empty cathedral. You know these marks. You\'ve seen them in Kelemvor\'s oldest texts \u2014 the passages the temple doesn\'t teach to initiates, the ones written in margins by priests who wished they could forget what they\'d learned. The seal feels like a prayer \u2014 not protection FROM death, but protection from something worse than death. Your faith tells you this box was sealed with the same gravity that Kelemvor himself uses to judge the dead. Whatever is inside was judged too dangerous to exist.\n\nYour holy symbol feels heavy against your chest. Your god is watching. You are certain of it.'
        },
        {
          id: 'a5-dm-lome-moment', type: 'dm-tip',
          title: 'Give L\u00f3m\u00eb\'s Moment Weight',
          text: 'This is L\u00f3m\u00eb\'s moment. She has +6 Religion with advantage \u2014 she\'ll almost certainly hit DC 16. Give this narration weight. Lower your voice. Let the table go quiet. If L\u00f3m\u00eb\'s player has questions, answer them in character as divine intuition, not exposition.'
        },
        {
          id: 'a5-check-religion-20', type: 'skill-check',
          check: 'Religion', dc: 20,
          text: 'The symbols specifically reference the Pashupatastra \u2014 the weapon of the Destroyer, capable of unmaking all creation. Even the gods sealed it away. This is a fragment of that weapon.'
        },
        {
          id: 'a5-read-religion-20', type: 'read-aloud',
          text: 'And then the final piece falls into place \u2014 and your blood goes cold. You know this symbol. The outermost ring of markings, the ones that looked like abstract patterns \u2014 they\'re not abstract. They\'re a name, written in a script so old it predates Common by millennia. Pashupatastra. The weapon of the Destroyer. The thing the gods themselves sealed away because even they were afraid of what it could do \u2014 unmake all of creation, every plane, every soul, everything that has ever existed or ever will. The myths say even speaking its name draws its attention.\n\nThis box contains a fragment of that weapon.\n\nAnd someone hired you to steal it.'
        },
        {
          id: 'a5-dm-lome-odds', type: 'dm-note',
          title: 'L\u00f3m\u00eb\'s Odds on Religion Checks',
          text: 'L\u00f3m\u00eb with advantage (+6): DC 16 succeeds ~80% of the time. DC 20 with advantage: ~30%. She\'s the party\'s best shot at the full reveal.'
        },
        {
          id: 'a5-conditional-open-attempt', type: 'conditional',
          condition: 'They try to open the box',
          outcome: 'It won\'t budge. The seal holds firm. The box grows warm to the touch, then cold. Then still.'
        },
        {
          id: 'a5-read-open-attempt', type: 'read-aloud',
          text: 'You press, pry, twist. Nothing. The box doesn\'t resist \u2014 it simply doesn\'t acknowledge the attempt. And then, for a moment, the surface grows warm in your hands. Not unpleasant. Almost\u2026 inviting. Then cold. Then perfectly, impossibly still \u2014 like holding a stone that has never been touched by sunlight.'
        }
      ]
    },
    {
      id: 'act-5-transition', title: 'Transition to Act 6',
      blocks: [
        {
          id: 'a5-read-transition', type: 'read-aloud',
          vtt: { scene: 'S22' },
          text: 'You have the box. It sits in your hand \u2014 or your pocket, or your pack \u2014 and the weight of it is all wrong. Too light for what it is. Too heavy for what it means. The geometric patterns on its surface have gone still, like an animal playing dead.\n\nBelow you, the gala continues. Music. Laughter. The clink of crystal. None of them know what just happened three floors above their heads. None of them know what you\'re carrying.\n\nTime to go. The front door, the servants\' entrance, the garden wall \u2014 however you came in, you need to leave. And you need to do it now, before someone notices the box is gone, before whatever message that ward sent reaches the wrong ears, before this job stops being a heist and starts being something else entirely.\n\nLocke is waiting. Dawn is coming. Move.'
        }
      ]
    }
  ]
},
    {
  id: 'act-6',
  number: 6,
  title: 'The Escape & The Finale',
  duration: '~30-40 min',
  sections: [
    {
      id: 'act-6-getting-out',
      title: 'Part 1: Getting Out',
      blocks: [
        {
          id: 'a6-clean-exit',
          type: 'conditional',
          condition: 'Heat 0\u20131 (Unnoticed/Suspicious)',
          label: 'Clean Exit',
          outcome: 'Simple Stealth DC 12 check to avoid a last-minute patrol. Failure means a brief tense moment but nothing more\u2014they make it out.'
        },
        {
          id: 'a6-clean-exit-read-aloud',
          type: 'read-aloud',
          text: 'You retrace your steps through the mansion\u2014back down the narrow stairwell, through corridors now emptied of all but the most dedicated partygoers. The music has shifted to something slower, drowsier. Glasses clink. Laughter drifts through the walls. Nobody looks twice at you. Nobody even looks once.\n\nThe night air hits you as you slip through the servants\u2019 entrance\u2014cool and salt-sharp, carrying the distant creak of ships at anchor. Behind you, the Veymar estate glows like a lantern, oblivious. The puzzle box is a hard weight in your pack.\n\nYou did it. You actually did it.'
        },
        {
          id: 'a6-arcane-lockdown',
          type: 'conditional',
          condition: 'Heat 2 (Alarmed)',
          label: 'Arcane Lockdown',
          outcome: 'The mansion locks down with arcane wards. The party must complete a skill challenge to escape.'
        },
        {
          id: 'a6-lockdown-read-aloud',
          type: 'read-aloud',
          text: 'A deep hum reverberates through the walls. The windows flash with blue-white light as arcane sigils bloom across every door frame and window in the mansion. The exits are sealed. From below, you hear Captain Helm\u2019s voice, clipped and furious: \u201CLock it down. Nobody leaves.\u201D'
        },
        {
          id: 'a6-skill-challenge-intro',
          type: 'narrative',
          text: '**Skill Challenge: Escape the Estate (4 successes before 3 failures)**\n\nEach player describes their action. Assign a DC 14\u201316 check based on their approach.'
        },
        {
          id: 'a6-skill-challenge-examples',
          type: 'dm-note',
          title: 'Skill Challenge Example Approaches',
          text: '**Example approaches:**\n\u2022 Dispel Magic on a sealed door (automatic success\u2014costs a spell slot)\n\u2022 Athletics to smash through a window (DC 15, takes 1d6 slashing damage)\n\u2022 Arcana to temporarily suppress the ward on an exit (DC 16)\n\u2022 Stealth to evade a guard patrol in the chaos (DC 14)\n\u2022 Deception to impersonate a panicking noble and get guards to open a door (DC 15)'
        },
        {
          id: 'a6-skill-challenge-outcomes',
          type: 'dm-note',
          title: 'Skill Challenge Outcomes',
          text: '**On success (4 before 3):** They escape through a gap in the lockdown.\n\n**On failure (3 before 4):** They escape but are chased. 4 Guards intercept them on the grounds. Quick combat or one final group Stealth DC 15 to lose the pursuit in the Sea District streets.'
        }
      ]
    },
    {
      id: 'act-6-transition',
      title: 'Crossing the City',
      blocks: [
        {
          id: 'a6-crossing-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S22', mode: 'theater' },
          text: 'The walk from the Sea District to the Dock District feels longer than it should. The streets change beneath your feet\u2014smooth cobblestones giving way to cracked paving, then to packed dirt and salt-stained planks. The ward lights dim. The buildings slouch closer together. The smell of money fades into the smell of the sea.\n\nNobody speaks much. The puzzle box sits in its pack like a held breath. Every shadow feels like it\u2019s watching. Every footstep behind you could be a guard, a rival, a mistake catching up.\n\nThe address Locke gave you leads to the warehouse district\u2014rows of squat buildings with rusted padlocks and boarded windows. The kind of place where business happens after dark and questions get answered with silence.'
        },
        {
          id: 'a6-crossing-dm-note',
          type: 'dm-note',
          title: 'Let Them Breathe',
          text: 'This is a good moment to let the players talk in character. They\u2019ve just pulled off a heist\u2014let them celebrate, worry, or argue about whether to open the box. If they try to open it, it won\u2019t budge (the seal holds). If they try to examine it further, refer to the Arcana/Religion checks from Act 5\u2014they may not have tried all of them yet. Don\u2019t rush this moment. The quiet before the storm makes the betrayal hit harder.'
        },
        {
          id: 'a6-cue-warehouse-map', type: 'vtt-cue',
          label: 'Load Warehouse Map + Combat Preset',
          vtt: { map: 'M06', mode: 'map', preset: 'M06-combat' }
        }
      ]
    },
    {
      id: 'act-6-drop-off',
      title: 'Part 2: The Drop-Off',
      blocks: [
        {
          id: 'a6-warehouse-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S23' },
          text: 'Locke\u2019s instructions lead you to a warehouse at the far edge of the Dock District\u2014the kind of building that looks abandoned on purpose. The door is unlocked. Inside, the space has been cleared except for a large circle etched into the stone floor in what looks like dried blood. Five points of the circle are marked with iron braziers, already lit with pale blue flame. Locke stands at the center, still wearing that calm, faintly amused expression.\n\n\u201CYou have it. Good. You\u2019ve done well.\u201D He extends a gloved hand. \u201CThe box, please.\u201D'
        },
        {
          id: 'a6-ritual-circle-observations',
          type: 'dm-note',
          title: 'What the Party Notices (Passive Perception)',
          text: '**The Ritual Circle:**\nPlayers with Arcana DC 12 or passive Perception 14+ notice:\n\u2022 The circle has **five points**. There are **five** of them.\n\u2022 The braziers ignited as they entered\u2014they didn\u2019t see Locke light them.\n\u2022 The \u201Cdried blood\u201D in the circle\u2019s lines is fresh underneath.\n\nThree PCs have Passive Perception 16 (Martin, L\u00F3m\u00EB, Oda)\u2014they **automatically** notice all of this. Multiple characters realizing simultaneously creates a great dramatic moment. Describe worried glances, hands drifting to weapons, a shared unspoken \u201Csomething is wrong.\u201D Give the party a beat to react before Locke speaks.'
        },
        {
          id: 'a6-party-refuses',
          type: 'dm-note',
          title: 'If the Party Refuses to Enter',
          text: '**If the Party Refuses to Enter:** This party has high Perception and multiple magic-sensitive characters. There\u2019s a real chance they stop at the warehouse door.\n\nIf they hesitate: Locke steps forward, still in disguise, hands open. \u201CWhat\u2019s wrong? You have the box. I have your gold. Let\u2019s finish this.\u201D The braziers sit outside the main circle\u2014they appear decorative. An Arcana DC 16 check reveals the circle is magical (L\u00F3m\u00EB has +6, Martin gets +3 from Jack of All Trades).\n\nIf they refuse to enter: Locke grows impatient. The reveal happens at the warehouse entrance instead\u2014he drops the disguise, and the 2 Cult Fanatics emerge from behind crates to push the party toward the circle by force. The fight begins immediately with **no ritual active** (the ritual only activates once all 5 PCs are inside the circle, or Locke triggers it manually as a last resort\u2014in which case it requires a full round to activate and deals only 2d8 necrotic instead of 3d8, representing an imperfect binding).'
        },
        {
          id: 'a6-reveal-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S24', effect: 'rakshasa-reveal' },
          text: 'Locke takes the box and turns it over in his hands, running a gloved thumb across the shifting patterns. Then he chuckles\u2014a low, resonant sound that doesn\u2019t quite match his frame.\n\n\u201CYou know what I appreciate about your kind? You\u2019re so... reliable. Give a human a bag of gold and a target, and they\u2019ll walk right into the lion\u2019s den. Every time.\u201D\n\nHe pulls off his gloves. His hands are wrong\u2014the fingers bend backward, the palms where the backs should be. The skin ripples, and the face you knew as Locke cracks apart like a porcelain mask. Beneath it is something elegant and terrible: tiger-striped skin, golden eyes, a mouth full of fangs curved into a smile.'
        },
        {
          id: 'a6-reveal-continued',
          type: 'read-aloud',
          text: '\u201CThe box requires five souls to open. Freely walking into a circle of binding counts as \u2018freely given\u2019\u2014at least, close enough for the magic to accept. And here you are. All five of you. Right where I need you.\u201D\n\nThe braziers flare. The circle beneath your feet begins to glow.'
        }
      ]
    },
    {
      id: 'act-6-monologue',
      title: 'Locke\u2019s Monologue',
      blocks: [
        {
          id: 'a6-monologue-intro',
          type: 'dm-note',
          title: 'Monologue Timing',
          text: 'Read this as the circle activates\u2014the ritual needs a few moments to build, so he talks because he can afford to.'
        },
        {
          id: 'a6-monologue-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S24' },
          text: 'He holds the box up, turning it in the light of the braziers. His smile widens\u2014not the polished smile of the man called Locke, but something older, hungrier.\n\n\u201CDo you know what this is? Not a puzzle. Not a trinket. This is a fragment of the Pashupatastra\u2014the weapon of the Destroyer. The gods themselves couldn\u2019t bear to look at it. So they broke it apart, sealed the pieces in prisons of blood magic, and scattered them across the planes. They thought that would be enough.\u201D\n\nHe chuckles softly, almost fondly.\n\n\u201CBut the gods made one mistake. They used mortal souls as the lock. And mortals\u2014oh, you beautiful, predictable creatures\u2014you can always be bought.\u201D\n\nThe circle pulses brighter. You feel something pulling at you from inside your chest\u2014not pain, not yet, but a hollowing. Like something is being measured.\n\n\u201CYou don\u2019t believe me yet. I can see it in your eyes\u2014you think this is a trick, a bluff, something you can fight your way out of.\u201D\n\nHe leans forward, golden eyes burning.\n\n\u201CYou will believe. Before this circle finishes its work, you will become\u2026 true believers.\u201D\n\nHe straightens, spreading his arms wide as if conducting an orchestra. When he speaks again, the words are not in any language you know\u2014they\u2019re older than language, guttural syllables that make the braziers roar and the blood-circle crack with light:\n\n\u201CPASHUPATA\u2026 SHAKTI DEH! VINASHA KA DWAR KHOLO!\u201D'
        },
        {
          id: 'a6-monologue-dm-translation',
          type: 'dm-note',
          title: 'Infernal Translation',
          text: 'This loosely translates to \u201CPashupata\u2026 give me power! Open the door of destruction!\u201D\u2014you don\u2019t need to explain this to the players. The sound of it is enough.'
        },
        {
          id: 'a6-monologue-final',
          type: 'read-aloud',
          vtt: { scene: 'S25' },
          text: '\u201CFive souls walk willingly into the circle. Five souls to break the seal. And with what\u2019s inside\u2014I will unmake this world and build it again in my image. No gods. No masters. Just me.\u201D\n\nHe looks at each of you in turn, still smiling.\n\n\u201CI want you to know\u2014you were excellent thieves. Truly. It\u2019s almost a shame.\u201D\n\nThe circle erupts with light. Roll initiative.'
        },
        {
          id: 'a6-cue-initiative', type: 'vtt-cue',
          label: 'Start Combat \u2014 Initiative Mode',
          vtt: { mode: 'initiative' }
        }
      ]
    },
    {
      id: 'act-6-final-battle',
      title: 'The Final Battle',
      blocks: [
        {
          id: 'a6-ritual-round-1',
          type: 'dm-note',
          title: 'Round 1: The Ritual Pulse',
          text: '**Round 1\u2014The Ritual:**\nAt initiative count 20 (losing ties), the ritual circle pulses. Each PC standing inside the circle must make a **DC 15 Charisma saving throw** or take **3d8 necrotic damage** (half on success) as the circle tries to drain their life force. Leaving the circle (moving 15+ feet from center) ends this effect for that PC.'
        },
        {
          id: 'a6-spell-immunity-critical',
          type: 'dm-note',
          title: 'CRITICAL: Spell Immunity at Start',
          text: '**CRITICAL:** This party maxes out at 3rd-level spell slots. Locke\u2019s immunity to \u201C3rd level and below\u201D means he is **immune to EVERY spell the party can cast** at the start of this fight. This includes Counterspell, Fireball, Spirit Guardians, Hold Person, all cantrips\u2014everything.'
        },
        {
          id: 'a6-what-works',
          type: 'dm-note',
          title: 'What Bypasses Spell Immunity',
          text: '**What DOES work against Locke (always):**\n\u2022 **Physical weapon attacks** (if the weapon is magical\u2014see below)\n\u2022 **Jean\u2019s Divine Smite** (delivered via weapon attack, not a spell)\n\u2022 **Oda\u2019s Primal Strike** (beast form attacks count as magical at level 6)\n\u2022 **Jean\u2019s Magic Weapon spell** (cast on his OWN weapon, not on Locke\u2014targets the weapon, not the Rakshasa)\n\u2022 **Martin\u2019s Cutting Words** (Bardic Inspiration feature, not a spell\u2014subtracts d8 from enemy attack/damage/check rolls)\n\u2022 **Bardic Inspiration, Healing Word, Bless** on allies (these target allies, not Locke)\n\u2022 **Dispel Magic on a DOMINATED ALLY** (targets the spell effect on the ally, not Locke\u2014see Dominate Person below)\n\u2022 **Brazier disruption** (Athletics checks\u2014no magic needed)'
        },
        {
          id: 'a6-martin-role',
          type: 'dm-note',
          title: "Martin's Combat Role",
          text: '**Martin\u2019s combat role:** Cutting Words to reduce Locke\u2019s rolls, Bardic Inspiration to boost allies, Healing Word to keep people up. He has no weapons and his spells can\u2019t target Locke. He\u2019s the **support MVP** who becomes a powerhouse as braziers fall.'
        },
        {
          id: 'a6-locke-tactics',
          type: 'dm-note',
          title: "Locke's Combat Tactics",
          text: '**Locke (Rakshasa)\u2014See stat-blocks.md for full stats**\n\u2022 Uses his first turn to cast **Dominate Person** on Jean LeMarque (DC 15 Wis save). See \u201CDominate Person on Jean\u201D below.\n\u2022 Fights intelligently\u2014he expected this to be easy and grows increasingly frustrated if the PCs fight well.\n\u2022 If reduced to half HP, snarls: *\u201CEnough! I\u2019ll peel the souls from your bodies the old-fashioned way.\u201D* Shifts to melee with claw attacks.'
        },
        {
          id: 'a6-locke-minions',
          type: 'dm-note',
          title: 'Cult Fanatic Tactics',
          text: '**Locke\u2019s Minions:**\n\u2022 **2 Cult Fanatics** emerge from the shadows at initiative count 10 in Round 1. They try to keep PCs inside the circle and maintain the ritual.\n\u2022 L\u00F3m\u00EB\u2019s Spirit Guardians vs. the Cultists\u2019 Spirit Guardians creates a dramatic competing-aura battlefield. Note: L\u00F3m\u00EB\u2019s Spirit Guardians won\u2019t affect Locke (spell immunity) but will shred the Cultists.\n\u2022 Cultist Hold Person (DC 11) is less threatening thanks to Jean\u2019s Aura\u2014if he\u2019s nearby. If he\u2019s dominated and walking away, the DC 11 becomes harder for L\u00F3m\u00EB (+3 WIS save without Aura = needs 8+, still OK).'
        },
        {
          id: 'a6-battlefield',
          type: 'dm-note',
          title: 'Battlefield Layout & Key Items',
          text: '**Battlefield:**\n\u2022 The warehouse is 60 ft x 40 ft. The ritual circle is 20 ft diameter in the center.\n\u2022 Crates and barrels along the walls (half cover).\n\u2022 **The +1 ornate dagger** is on a crate near the wall\u2014visible to anyone with passive Perception 14+ (three PCs have 16) or Investigation DC 10. This is the **Rogue\u2019s weapon** for this fight. Make sure it\u2019s findable early. (If Martin still has no equipment, this might be the first weapon he touches all session.)\n\u2022 **Jean\u2019s Warhorse:** The warehouse is tight but a Large creature (10x10 ft) can maneuver. If Jean summons his steed via Find Steed, Mounted Combatant gives him advantage on melee attacks vs. Medium or smaller creatures (Cult Fanatics, but NOT Locke who is also Medium). The lance\u2019s reach (10 ft) is useful for staying out of Spirit Guardians range. The door might be too narrow for a horse\u2014DM\u2019s call on whether it was open when they entered.\n\u2022 The door they entered through is now magically sealed (Dispel Magic DC 15, or Strength DC 20 to break).'
        },
        {
          id: 'a6-victory-conditions',
          type: 'dm-note',
          title: 'Victory Conditions',
          text: '**Victory Conditions:**\n\u2022 **Kill or incapacitate Locke.** He doesn\u2019t flee\u2014his arrogance is his downfall.\n\u2022 **Disrupt the ritual** (extinguish 3+ braziers) and escape through the door.\n\u2022 **Both**\u2014the ideal outcome.'
        }
      ]
    },
    {
      id: 'act-6-dominate-jean',
      title: 'Dominate Person on Jean',
      blocks: [
        {
          id: 'a6-dominate-overview',
          type: 'dm-note',
          title: 'Why Jean? (Save Odds)',
          text: 'Locke targets Jean\u2014the strongest martial PC with the weakest Wisdom save.\n\n**Jean\u2019s WIS save:** -1 (WIS) + 3 (Aura of Protection) = **+2 total.** Needs 13+ on d20. **40% chance to save. 60% chance to be dominated.**'
        },
        {
          id: 'a6-dominate-if-failed',
          type: 'dm-note',
          title: 'Dominated Jean: Damage Output',
          text: '**If dominated:** Jean has Extra Attack + Divine Smite. He can deal 1d8+3 (warhammer) + 2d8 (smite) per hit, twice per round. That\u2019s **30\u201340 damage per round against allies.** With AC 19 and 52 HP, he\u2019s incredibly hard to bring down without killing him.'
        },
        {
          id: 'a6-dominate-brilliant-tactic',
          type: 'dm-note',
          title: "Locke's Brilliant Tactic: Move the Aura",
          text: '**Locke\u2019s brilliant tactic:** Command Jean to move away from the party. The **Aura of Protection moves with Jean**\u2014suddenly the remaining PCs lose their +3 to saves, making the ritual\u2019s Charisma save and Locke\u2019s other spells much more dangerous. This should feel like a coordinated strike.'
        },
        {
          id: 'a6-dominate-counters',
          type: 'dm-note',
          title: 'Breaking the Domination',
          text: '**How the party can fight back:**\n\u2022 **Martin casts Dispel Magic on Jean** (targeting the Dominate Person effect ON Jean, not Locke). Dominate Person is 5th level, so Martin needs an ability check: d20 + 7 (spellcasting modifier) vs DC 15. Needs 8+\u2014likely to succeed. **This is Martin\u2019s most important spell of the fight.**\n\u2022 **L\u00F3m\u00EB\u2019s Sentinel at Death\u2019s Door** negates critical hits from a dominated Jean (3 uses/LR)\n\u2022 **Oda in beast form can grapple Jean** to limit his movement (beast STR is often very high)\n\u2022 **Jean gets a new save each time he takes damage**\u2014allies can deliberately deal small amounts (unarmed strikes, 1 damage) to give him chances\n\u2022 The Rogue can use **Cunning Action** to stay out of Jean\u2019s reach'
        },
        {
          id: 'a6-dominate-roleplay',
          type: 'dm-note',
          title: 'Roleplay: Dominated Jean',
          text: '**Roleplay:** Jean\u2019s personality is \u201Celoquent flattery\u201D and \u201Chero of the people.\u201D Being forced to attack his friends should be horrifying\u2014his mouth says charming things while his body swings the warhammer. Riley should love this dramatic moment.'
        },
        {
          id: 'a6-aura-vs-ritual',
          type: 'dm-note',
          title: 'Aura of Protection vs. Ritual Saves',
          text: '**Aura of Protection vs. Ritual Saves:** With Jean\u2019s Aura active (+3), the ritual saves are fairly easy. Martin (+10 CHA save with Aura) auto-passes. Jean (+6) needs 9+. L\u00F3m\u00EB (+3) needs 12+. Oda (+3, but **Gnome Cunning grants advantage** on CHA saves vs. magic) has ~70% chance. If Jean is dominated and moves away, the Aura goes with him\u2014suddenly everyone loses +3, making the ritual far more dangerous. This urgency to break the Dominate is intentional.'
        },
        {
          id: 'a6-path-to-grave',
          type: 'dm-note',
          title: 'Path to the Grave + Smite Combo',
          text: '**Path to the Grave + Divine Smite Combo:**\n\n**Expect this.** L\u00F3m\u00EB uses Path to the Grave (Channel Divinity, action) to curse Locke with vulnerability to the next attack. Jean follows with a Divine Smite attack:\n\u2022 Warhammer (1d8+3) + Smite (2d8) = avg ~16 damage, **doubled to ~32**\n\u2022 This removes roughly 1/3 of Locke\u2019s 110 HP in one attack\n\n**Timing matters:** Path to the Grave costs L\u00F3m\u00EB\u2019s action, so it happens on her turn. Jean acts on his own turn. By then, Locke has likely already cast Dominate Person on Round 1. If Jean is dominated, the combo falls apart\u2014which makes the Dominate even more impactful. If Jean saved, this combo is devastating and should be rewarded.'
        }
      ]
    },
    {
      id: 'act-6-brazier-mechanic',
      title: 'Dynamic Brazier Mechanic',
      blocks: [
        {
          id: 'a6-brazier-intro',
          type: 'narrative',
          text: 'The braziers can be knocked over (Athletics DC 12). Each extinguished brazier has **two effects:**\n\n**Ritual Effect:** Each brazier extinguished reduces the ritual\u2019s Charisma save DC by 2. At 3+ braziers out, the ritual fails entirely and Locke loses concentration on ongoing spells.\n\n**Spell Immunity Effect:** Each brazier also reduces Locke\u2019s spell immunity by one level. The braziers are anchoring the ritual that empowers him\u2014as they fall, his defenses crumble.'
        },
        {
          id: 'a6-brazier-table',
          type: 'table',
          caption: 'Brazier Levels, Immunity & Spells Unlocked',
          headers: ['Braziers Out', 'Spell Immunity', 'Ritual Save DC', 'What Unlocks'],
          rows: [
            ['0 (start)', 'Immune to 3rd level and below', 'DC 15', 'Nothing\u2014physical attacks only'],
            ['1', 'Immune to 2nd level and below', 'DC 13', '**3rd-level spells work:** Counterspell, Fireball, Dispel Magic, Spirit Guardians, Hypnotic Pattern'],
            ['2', 'Immune to 1st level and below', 'DC 11', '**2nd-level spells work:** Hold Person, Suggestion, Heat Metal, Silence, Invisibility'],
            ['3+', 'Immune to cantrips only / **Ritual fails**', 'Ritual ends', '**1st-level spells work:** Command, Tasha\u2019s Hideous Laughter. Locke loses concentration.'],
            ['4+', '**No spell immunity**', '\u2014', '**Everything works.** Cantrips, Vicious Mockery, Chill Touch\u2014full arsenal.']
          ]
        },
        {
          id: 'a6-brazier-narrative-reason',
          type: 'dm-note',
          title: 'Why Braziers Work Narratively',
          text: '**Why this works narratively:** The braziers aren\u2019t just ritual components\u2014they\u2019re channels of fiendish power that sustain Locke\u2019s supernatural defenses. As the ritual crumbles, so does he. The party experiences a dramatic arc: spells bouncing off \u2192 scrambling for braziers \u2192 the moment Counterspell becomes available \u2192 unleashing everything at once.'
        }
      ]
    },
    {
      id: 'act-6-victory-epilogue',
      title: 'Victory & Epilogue',
      blocks: [
        {
          id: 'a6-locke-defeated-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S25' },
          text: 'The Rakshasa crumples, that terrible smile still frozen on his face even as the light fades from his golden eyes. The braziers gutter and die. The circle\u2019s glow flickers once, twice, and goes dark. The warehouse is suddenly, oppressively silent.\n\nThe puzzle box sits where Locke dropped it. Its geometric patterns have gone still\u2014truly still, for the first time since you\u2019ve held it. The shifting symbols that moved when you weren\u2019t looking are frozen in place, like a held breath.\n\nA fragment of the Pashupatastra. A weapon that could unmake the world. Still sealed. Still waiting.'
        },
        {
          id: 'a6-cue-epilogue', type: 'vtt-cue',
          label: 'Return to Theater \u2014 Epilogue',
          vtt: { scene: 'S26', mode: 'theater' }
        },
        {
          id: 'a6-epilogue-choices',
          type: 'narrative',
          text: 'The players now have choices. Let them discuss\u2014there\u2019s no wrong answer.'
        },
        {
          id: 'a6-epilogue-options',
          type: 'dm-note',
          title: 'Epilogue: What Do They Do With the Box?',
          text: '**Epilogue choices:**\n\u2022 **Keep the box.** A fragment of a god-killing weapon is the most dangerous thing in Waterdeep. Who else knows about it? Locke didn\u2019t work alone\u2014those Cult Fanatics came from somewhere.\n\u2022 **Destroy it.** Arcana DC 20 reveals: the box can\u2019t be destroyed by mundane means. Veymar\u2019s journal (if they looted his study) suggests he spent months trying. A temple of Mystra or Helm might know how\u2014but would they?\n\u2022 **Return it to Lord Veymar.** He was trying to figure out how to destroy it. Maybe he\u2019s the right custodian\u2014or maybe his obsession makes him the worst one.\n\u2022 **Give it to a faction.** The Harpers, the Lords\u2019 Alliance, a temple. But can you trust any organization with the power to end the world?\n\u2022 **Walk away.** Leave it in the warehouse. Not their problem anymore. But they\u2019ll always know it\u2019s out there.'
        },
        {
          id: 'a6-final-read-aloud',
          type: 'read-aloud',
          vtt: { scene: 'S26' },
          text: 'The night air of the Dock District hits you as you step outside. The salt, the brine, the distant creak of ships at anchor. Waterdeep goes on, oblivious to what almost happened in this warehouse.\n\nSomewhere out in the planes, the other fragments of the Pashupatastra still exist\u2014sealed in their own boxes, protected by their own locks. Locke is dead, but he was just one Rakshasa. The weapon of the Destroyer was broken into pieces for a reason.\n\nTonight, you kept one piece sealed. One lock held.\n\nFor now.'
        }
      ]
    }
  ]
}
  ],
  npcs: {
  locke: {
    name: 'Locke',
    role: 'Employer / Middleman (Rakshasa in disguise)',
    personality: 'Polished, calm, faintly amused \u2014 like he knows something you don\u2019t',
    location: 'The Rusty Anchor tavern / Drop-off warehouse',
    tooltipSummary: 'Rakshasa in disguise. Polished, calm, faintly amused. Hired the party to steal the puzzle box.',
    statBlockRef: 'locke',
    details: 'Locke specifically wanted five people for the job. Wears gloves (inverted hands). Doesn\u2019t eat or drink. Insight DC 20 reveals something \u201Crehearsed\u201D about his mannerisms.'
  },
  veymar: {
    name: 'Lord Veymar',
    role: 'Owner of the estate & puzzle box',
    personality: 'Paranoid, aristocratic, obsessed with arcane artifacts',
    location: 'His study or the ballroom',
    tooltipSummary: 'Paranoid aristocrat who owns the puzzle box. Discovered it requires five souls to open.',
    statBlockRef: null,
    details: 'Veymar discovered the box contains a fragment of the Pashupatastra and was desperately trying to find a way to destroy it. His journal reads: \u201CIf I cannot destroy it, I must ensure no one ever opens it. Five souls. That is the price.\u201D'
  },
  helm: {
    name: 'Captain Dara Helm',
    role: 'Head of estate security',
    personality: 'Professional, sharp-eyed, by-the-book',
    location: 'Patrols the grounds, stationed at main gate',
    tooltipSummary: 'Head of estate security. Uses Veteran stat block (MM p. 350), 58 HP, Multiattack.',
    statBlockRef: 'guard',
    details: 'Captain Helm uses the Veteran stat block (58 HP, Multiattack with 2 longsword attacks). Pickpocketing her key is DC 17. Estate has ~12 guards total.'
  },
  pip: {
    name: 'Pip',
    role: 'Kitchen servant, potential informant',
    personality: 'Nervous, underpaid, easily bribed',
    location: 'Servant\u2019s quarters / kitchen',
    tooltipSummary: 'Kitchen servant who can be bribed for intel about the estate.',
    statBlockRef: null,
    details: 'Nervous and underpaid. Can be bribed for information about the mansion layout, guard rotations, or Veymar\u2019s habits.'
  },
  thessaly: {
    name: 'Lady Thessaly',
    role: 'Veymar\u2019s wife, socialite',
    personality: 'Charming, gossipy, secretly resents her husband',
    location: 'The ballroom',
    tooltipSummary: 'Veymar\u2019s wife. Charming and gossipy, secretly resents her husband.',
    statBlockRef: null,
    details: 'Charming socialite who secretly resents Lord Veymar. Can be a source of information about the estate if engaged in conversation at the ballroom.'
  },
  knuckles: {
    name: 'Gareth \u201CKnuckles\u201D Brune',
    role: 'Black market fence in the Dock District',
    personality: 'Gruff, transactional, knows everyone',
    location: 'The Dock District',
    tooltipSummary: 'Black market fence. Sells Potion of Invisibility (300 gp) and Masterwork Thieves\u2019 Tools (200 gp).',
    statBlockRef: null,
    details: 'Gruff fence who sells a Potion of Invisibility (300 gp) and Masterwork Thieves\u2019 Tools (+2 bonus, 200 gp). Doesn\u2019t give refunds and doesn\u2019t remember faces.'
  }
},
  pcs: {
  martin: {
    name: 'Martin Storm',
    player: 'Robben',
    class: 'Human Bard 6 (College of Lore)',
    ac: 12,
    hp: 45,
    passivePerception: 16,
    passiveInsight: 13,
    keyAbility: 'Performance +7, Cutting Words (subtract d8 from enemy rolls), Counterspell, Alert feat (+5 Initiative)',
    keySkills: 'Performance +7, Intimidation +7, Persuasion +5, Stealth +5',
    savingThrows: 'DEX +5, CHA +7',
    weakness: 'Deception +1, no equipment on character sheet',
    spells: 'Counterspell, Fireball, Invisibility, Dispel Magic, Healing Word',
    magicDamage: 'No (support role)',
    notes: 'Support MVP. Cutting Words, Bardic Inspiration, Healing Word. His most important spell is Dispel Magic on a dominated ally. Becomes a powerhouse as braziers fall.'
  },
  lome: {
    name: 'L\u00F3m\u00EB',
    player: 'Kati',
    class: 'Elf Cleric 6 (Grave Domain)',
    ac: 15,
    hp: 45,
    passivePerception: 16,
    passiveInsight: 16,
    keyAbility: 'Sentinel at Death\u2019s Door (negate crits 3x/LR), Path to the Grave (Channel Divinity \u2014 give vulnerability to next attack)',
    keySkills: 'Perception +6, Insight +6, Religion +6',
    savingThrows: 'WIS +6, CHA +3',
    weakness: 'Mace is mundane; spells blocked by Locke\u2019s immunity until braziers fall',
    spells: 'Cure Wounds, Healing Word, Spirit Guardians, Spiritual Weapon',
    magicDamage: 'Not until braziers fall',
    notes: 'Worships Kelemvor (god of the dead). Darkvision 60 ft. Immune to magical sleep, advantage vs. Charmed. Best early offense is Path to the Grave setting up Jean or Oda for doubled damage.'
  },
  oda: {
    name: 'Oda \u201CBearda\u201D Timbers',
    player: 'Andrea',
    class: 'Forest Gnome Druid 6 (Circle of the Moon)',
    ac: 16,
    hp: 45,
    passivePerception: 16,
    passiveInsight: 13,
    keyAbility: 'Wild Shape CR 2 (bonus action), Primal Strike (beast attacks count as magical)',
    keySkills: 'Animal Handling +6, Perception +6, Survival +6',
    savingThrows: 'INT +5, WIS +6',
    weakness: 'Caster form is fragile; limited spell slots',
    spells: 'Healing Word, Goodberry',
    magicDamage: 'Yes (Primal Strike)',
    notes: 'Most reliable magical damage source from Round 1. Gnome Cunning (advantage on INT/WIS/CHA saves vs. magic). Can scout as spider/rat/cat. Darkvision 60 ft.'
  },
  jean: {
    name: 'Jean LeMarque',
    player: 'Riley',
    class: 'Variant Human Paladin 6 (Oath of Conquest)',
    ac: 19,
    hp: 52,
    passivePerception: 9,
    passiveInsight: 9,
    keyAbility: 'Aura of Protection (+3 to ALL saves within 10 ft), Extra Attack + Divine Smite, Conquering Presence (frighten DC 14)',
    keySkills: 'Intimidation +6, Persuasion +6, Athletics +6',
    savingThrows: 'WIS +2, CHA +6',
    weakness: 'WIS 8 (\u22121) \u2014 vulnerable to Dominate Person. Passive Perception/Insight/Investigation of 9. Misses everything subtle.',
    spells: 'Magic Weapon, Find Steed',
    magicDamage: 'Needs Magic Weapon spell (2nd level, cast on own weapon)',
    notes: 'Mounted Combatant feat + Warhorse. Knight background. Divine Smite radiant damage bypasses Locke\u2019s spell immunity (delivered via weapon, not a spell), but base weapon damage is blocked without Magic Weapon. Lay on Hands 30 HP.'
  },
  rogue: {
    name: 'Kallista',
    player: 'Maegan',
    class: 'Tiefling Rogue 6 (Swashbuckler)',
    ac: 12,
    hp: 39,
    passivePerception: 10,
    passiveInsight: 10,
    keyAbility: 'Sneak Attack 3d6, Cunning Action, Uncanny Dodge, Fancy Footwork (no OA after melee), Rakish Audacity (CHA to init, Sneak Attack 1v1)',
    keySkills: 'Stealth +8, Deception +8, Sleight of Hand +8, Acrobatics +8',
    savingThrows: 'DEX +5, INT +4',
    weakness: 'Low HP (39), AC 12, WIS +0 \u2014 vulnerable to Dominate Person',
    spells: 'Thaumaturgy, Hellish Rebuke (1/day, 2d10 fire), Darkness (1/day)',
    magicDamage: 'Needs +1 ornate dagger from warehouse',
    notes: 'Swashbuckler \u2014 Fancy Footwork lets her hit-and-run without OAs. Rakish Audacity adds CHA to initiative and Sneak Attack works 1v1. Infernal Constitution: cold/poison resist, advantage vs. poison saves. Darkvision 60 ft. Thieves\u2019 Tools + Disguise Kit + Forgery Kit. Critical for traps, locks, display case.'
  }
},
  statBlocks: {
  locke: {
    name: 'Locke \u2014 Rakshasa (Modified)',
    type: 'Medium fiend, lawful evil',
    ac: '16 (natural armor)',
    hp: '110 (reduced from 150 \u2014 the ritual is draining him)',
    speed: '40 ft.',
    str: 14,
    dex: 17,
    con: 18,
    int: 16,
    wis: 16,
    cha: 20,
    skills: 'Deception +10, Insight +8, Perception +8',
    vulnerabilities: 'Piercing from magic weapons wielded by good creatures',
    immunities: 'Bludgeoning, piercing, and slashing from nonmagical attacks',
    senses: 'Darkvision 60 ft., passive Perception 18',
    languages: 'Common, Infernal',
    features: [
      {
        name: 'Weakened Magic Immunity',
        text: 'Locke is immune to spells of 3rd level or lower (reduced from 6th). Spells of 4th level or higher affect him normally. He can still choose to be affected by a spell if he wishes. IMPORTANT: This party has no spell slots above 3rd level. At the start of the fight, Locke is immune to every spell the PCs can cast.'
      },
      {
        name: 'Dynamic Brazier Interaction',
        text: '5 lit (start): Immune to 3rd level and below. 4 lit (1 out): Immune to 2nd level and below \u2014 3rd-level spells now work (Counterspell, Fireball, Dispel Magic, Spirit Guardians). 3 lit (2 out): Immune to 1st level and below \u2014 2nd-level spells now work (Hold Person, Suggestion, Heat Metal). 2 lit (3 out): Immune to cantrips only \u2014 1st-level spells now work. Ritual fails. Locke loses concentration. 1 or 0 lit: No spell immunity at all \u2014 cantrips work. Full arsenal available.'
      },
      {
        name: 'Innate Spellcasting',
        text: 'Spellcasting ability: Charisma (spell save DC 15, +7 to hit with spell attacks). At will: Detect Thoughts, Disguise Self, Mage Hand, Minor Illusion. 3/day each: Charm Person, Detect Magic, Suggestion. 1/day each: Dominate Person, Fly, Plane Shift (self only \u2014 escape option).'
      }
    ],
    actions: [
      {
        name: 'Multiattack',
        text: 'Locke makes two claw attacks.'
      },
      {
        name: 'Claw',
        text: 'Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 9 (2d6 + 2) slashing damage, and the target is cursed if it is a creature. The curse takes effect whenever Locke targets the cursed creature with an attack or a harmful spell \u2014 Locke has advantage on attack rolls against the cursed creature.'
      }
    ],
    tactics: 'Round 1: Cast Dominate Person on Jean LeMarque (WIS DC 15; Jean saves at +2, needs 13+, 60% chance of failure). Command Jean to move away from the party \u2014 his Aura of Protection (+3 to saves) leaves with him. Round 2\u20133: If Dominate worked, command Jean to attack allies (30\u201340 damage/round with Extra Attack + Smite). Use Suggestion on a second PC. Fall back to claw attacks on whoever is disrupting braziers. Half HP (55): Drops spellcasting, goes full melee. Two claw attacks per turn. Targets whoever damaged him most. Snarls: \u201CEnough! I\u2019ll peel the souls from your bodies the old-fashioned way.\u201D Key threat: If Martin casts Dispel Magic on Jean to break Dominate (targets Jean, not Locke \u2014 works despite immunity), Locke should prioritize clawing Martin. Dying monologue: \u201CYou think this ends with me? The box will be opened. If not tonight\u2026 soon.\u201D'
  },
  cultFanatic: {
    name: 'Cult Fanatic (\u00D72)',
    type: 'Medium humanoid, any alignment',
    ac: '13 (leather armor)',
    hp: '33 (6d8 + 6)',
    speed: '30 ft.',
    str: 11,
    dex: 14,
    con: 12,
    int: 10,
    wis: 13,
    cha: 14,
    skills: 'Deception +4, Persuasion +4, Religion +2',
    vulnerabilities: null,
    immunities: null,
    senses: 'Passive Perception 11',
    languages: null,
    features: [
      {
        name: 'Spellcasting',
        text: '5th-level spellcaster. Spell save DC 11, +3 to hit. Cantrips: Light, Sacred Flame (2d8), Thaumaturgy. 1st level (4 slots): Command, Inflict Wounds, Shield of Faith. 2nd level (3 slots): Hold Person, Spiritual Weapon. 3rd level (2 slots): Spirit Guardians.'
      }
    ],
    actions: [
      {
        name: 'Multiattack',
        text: 'One melee attack and one Sacred Flame.'
      },
      {
        name: 'Dagger',
        text: 'Melee/Ranged: +4 to hit, 1d4 + 2 piercing.'
      }
    ],
    tactics: 'One casts Spirit Guardians and stands near the circle to punish PCs who try to extinguish braziers. The other opens with Hold Person on a PC who escaped the circle, then uses Spiritual Weapon + Sacred Flame each round. They fight to the death \u2014 they\u2019re true believers.'
  },
  guard: {
    name: 'Guard (Estate Security)',
    type: 'Medium humanoid, lawful neutral',
    ac: '16 (chain shirt + shield)',
    hp: '22 (3d8 + 3) \u00D72 for veterans',
    speed: '30 ft.',
    str: 13,
    dex: 12,
    con: 12,
    int: 10,
    wis: 11,
    cha: 10,
    skills: 'Perception +2',
    vulnerabilities: null,
    immunities: null,
    senses: 'Passive Perception 12',
    languages: null,
    features: [],
    actions: [
      {
        name: 'Longsword',
        text: 'Melee: +3 to hit, 1d8 + 1 slashing (1d10 + 1 two-handed).'
      }
    ],
    tactics: 'Guards patrol in pairs. They call for backup if one goes down (2 more arrive in 3 rounds). Captain Helm uses the Veteran stat block (MM p. 350) with 58 HP and Multiattack (2 longsword attacks). Estate has ~12 guards total. The party should NOT fight them all \u2014 if they\u2019re fighting more than 4 at once, things have gone very wrong.'
  },
  mastiff: {
    name: 'Mastiff (Guard Dogs, \u00D72)',
    type: 'Medium beast, unaligned',
    ac: '12',
    hp: '5 (1d8 + 1)',
    speed: '40 ft.',
    str: 13,
    dex: 14,
    con: 12,
    int: 3,
    wis: 12,
    cha: 7,
    skills: 'Perception +3',
    vulnerabilities: null,
    immunities: null,
    senses: 'Passive Perception 13',
    languages: null,
    features: [],
    actions: [
      {
        name: 'Bite',
        text: 'Melee: +3 to hit, 1d6 + 1 piercing. Target must succeed on DC 11 Str save or be knocked prone.'
      }
    ],
    tactics: 'Patrol the hedge maze. Can be calmed with Animal Handling DC 15 or distracted with food (DC 10). If they bark, +1 Heat.'
  }
},
  spells: {
  'Dispel Magic': {
    level: 3,
    school: 'Abjuration',
    description: 'End one spell on a target. Higher-level spells require an ability check (DC 10 + spell level). Martin\u2019s most important spell \u2014 use on Jean to break Dominate Person (d20+7 vs DC 15, needs 8+). Targets the spell effect on the ally, not Locke, so it works despite Locke\u2019s immunity.'
  },
  'Counterspell': {
    level: 3,
    school: 'Abjuration',
    description: 'Interrupt a creature casting a spell. If the spell is 4th level or higher, make an ability check (DC 10 + spell level). Blocked by Locke\u2019s immunity until 1 brazier is extinguished.'
  },
  'Fireball': {
    level: 3,
    school: 'Evocation',
    description: '8d6 fire damage in a 20-ft radius (DEX save for half). Blocked by Locke\u2019s immunity until 1 brazier is extinguished. Be careful of friendly fire in the warehouse.'
  },
  'Dominate Person': {
    level: 5,
    school: 'Enchantment',
    description: 'One humanoid must succeed on a WIS save or be charmed. You can issue commands as an action. The target gets a new save each time it takes damage. Locke\u2019s save DC is 15. Primary tactic: cast on Jean (WIS save +2, 60% failure).'
  },
  'Spirit Guardians': {
    level: 3,
    school: 'Conjuration',
    description: 'Spirits guard a 15-ft radius around you. Hostile creatures entering or starting their turn take 3d8 radiant/necrotic damage (WIS save for half). Concentration, up to 10 minutes. Cult Fanatic uses this to punish PCs near braziers. L\u00F3m\u00EB\u2019s version won\u2019t affect Locke (spell immunity) but shreds Cultists.'
  },
  'Hold Person': {
    level: 2,
    school: 'Enchantment',
    description: 'One humanoid must succeed on a WIS save or be paralyzed. Target repeats the save at end of each turn. Attacks within 5 ft are auto-crits. Cult Fanatic DC 11. Blocked by Locke\u2019s immunity until 2 braziers are extinguished.'
  },
  'Suggestion': {
    level: 2,
    school: 'Enchantment',
    description: 'Suggest a reasonable course of action to a creature that can hear you. WIS save to resist. Lasts up to 8 hours. Locke uses: \u201CYou should leave \u2014 this isn\u2019t your fight.\u201D 2nd-level spell, blocked by immunity until 2+ braziers are out.'
  },
  'Invisibility': {
    level: 2,
    school: 'Illusion',
    description: 'A creature you touch becomes invisible until it attacks or casts a spell. Concentration, up to 1 hour. Martin has this prepared \u2014 useful for infiltration.'
  },
  'Magic Weapon': {
    level: 2,
    school: 'Transmutation',
    description: 'A nonmagical weapon becomes +1 (bonus action, concentration, up to 1 hour). Jean must cast this on his own weapon. Targets the weapon, not Locke, so spell immunity doesn\u2019t interfere. Essential for Jean\u2019s base weapon damage to bypass Locke\u2019s nonmagical damage immunity.'
  },
  'Command': {
    level: 1,
    school: 'Enchantment',
    description: 'Speak a one-word command to a creature. WIS save or follow the command on its next turn (e.g., Flee, Grovel, Halt, Drop). Cult Fanatic spell (DC 11).'
  },
  'Tasha\u2019s Hideous Laughter': {
    level: 1,
    school: 'Enchantment',
    description: 'A creature falls prone and becomes incapacitated, laughing. WIS save to resist. Repeats save at end of each turn and when it takes damage. Concentration.'
  },
  'Healing Word': {
    level: 1,
    school: 'Evocation',
    description: 'Bonus action: a creature within 60 ft regains 1d4 + spellcasting modifier HP. Available to Martin (Bard), L\u00F3m\u00EB (Cleric), and Oda (Druid). Critical for action-economy healing during the final battle.'
  },
  'Shield of Faith': {
    level: 1,
    school: 'Abjuration',
    description: '+2 AC to a creature you can see within 60 ft. Concentration, up to 10 minutes. Cult Fanatic buff spell.'
  },
  'Spiritual Weapon': {
    level: 2,
    school: 'Evocation',
    description: 'Create a floating spectral weapon. Bonus action to attack: spell attack, 1d8 + spellcasting mod force damage. No concentration. L\u00F3m\u00EB\u2019s version is blocked by Locke\u2019s immunity (2nd-level spell) until 2 braziers are out. Cult Fanatic also uses this.'
  },
  'Inflict Wounds': {
    level: 1,
    school: 'Necromancy',
    description: 'Melee spell attack: 3d10 necrotic damage. Cult Fanatic spell.'
  },
  'Sacred Flame': {
    level: 0,
    school: 'Evocation',
    description: 'Cantrip. Target makes a DEX save or takes 2d8 radiant damage (at 5th level). No cover benefit. Cult Fanatic uses each round with Multiattack.'
  },
  'Charm Person': {
    level: 1,
    school: 'Enchantment',
    description: 'One humanoid must succeed on a WIS save or be charmed by you for 1 hour. Advantage on save if in combat. Locke has this 3/day.'
  },
  'Detect Magic': {
    level: 1,
    school: 'Divination',
    description: 'Sense magic within 30 ft for up to 10 minutes (concentration). Three party casters can cast this \u2014 magical protections will be spotted.'
  },
  'Detect Thoughts': {
    level: 2,
    school: 'Divination',
    description: 'Read surface thoughts of creatures within 30 ft. WIS save to resist deeper probing. Locke has this at will.'
  }
},
  dcReference: [
  { check: 'Negotiate higher pay with Locke', dc: 18, notes: 'Martin +5 (Persuasion), Jean +6 (Persuasion)' },
  { check: 'Insight on Locke', dc: 20, notes: 'L\u00F3m\u00EB +6 (best), Martin +4 (Jack of All Trades), Jean \u22121' },
  { check: 'Intel-gathering (varies)', dc: '12\u201315', notes: 'Varies by source and approach' },
  { check: 'Infiltration entry checks', dc: '13\u201316', notes: 'Stealth, Deception, or Athletics depending on method' },
  { check: 'Mansion navigation', dc: '13\u201316', notes: 'Stealth and Perception checks inside the estate' },
  { check: 'Third-floor stairwell lock', dc: 15, notes: 'Thieves\u2019 Tools (Rogue likely auto-passes with Expertise)' },
  { check: 'Pickpocket Captain Helm\u2019s key', dc: 17, notes: 'Sleight of Hand' },
  { check: 'Arcane Ward bypass', dc: 16, notes: 'Dispel Magic auto-succeeds (Martin). Thieves\u2019 Tools DC 16 or Arcana DC 16.' },
  { check: 'Display case trap (disable)', dc: 15, notes: 'Thieves\u2019 Tools' },
  { check: 'Arcana (examine box, basic)', dc: 14, notes: 'Reveals the box is sealed with powerful magic' },
  { check: 'Arcana (examine box, full truth)', dc: 18, notes: 'Reveals \u201Cfive lives\u201D and blood magic' },
  { check: 'Ritual circle Charisma save', dc: 15, notes: '3d8 necrotic (half on success). Jean\u2019s Aura gives +3 if nearby.' },
  { check: 'Locke\u2019s Dominate Person (Wis save)', dc: 15, notes: 'Jean saves at +2 (needs 13+, 60% failure). With Aura: +5 (needs 10+).' }
],
  loot: [
  { item: 'Locke\u2019s payment', location: 'Chest near the warehouse wall', value: '2,500 gp' },
  { item: 'Ornate dagger (+1, magical)', location: 'On a crate in the warehouse (visible)', value: '250 gp', notes: 'Rogue needs this to deal damage through Locke\u2019s nonmagical immunity. Three PCs have passive Perception 16 \u2014 they\u2019ll spot it.' },
  { item: 'Signet ring (unfamiliar symbol)', location: 'Locke\u2019s body', value: 'Plot hook', notes: 'Bears the symbol of the Rakshasa network. Campaign hook for the Pashupatastra storyline.' },
  { item: 'Locke\u2019s gloves', location: 'Locke\u2019s body', value: 'Non-magical', notes: 'Unsettling. Evidence of his disguise.' },
  { item: 'Scroll of Counterspell', location: 'Veymar\u2019s study (if looted)', value: 'Uncommon', notes: 'Only available if the party looted the study during the heist.' },
  { item: 'Potion of Greater Healing', location: 'Veymar\u2019s study (if looted)', value: 'Uncommon', notes: 'Only available if the party looted the study during the heist.' },
  { item: 'Leather-bound journal about the box', location: 'Veymar\u2019s study (if looted)', value: 'Plot hook', notes: 'Veymar discovered the box contains a fragment of the Pashupatastra. Final entry: \u201CIf I cannot destroy it, I must ensure no one ever opens it. Five souls. That is the price.\u201D' },
  { item: 'Potion of Invisibility', location: 'Knuckles (Dock District)', value: '300 gp', notes: 'Available for purchase during intel-gathering phase.' },
  { item: 'Masterwork Thieves\u2019 Tools', location: 'Knuckles (Dock District)', value: '200 gp', notes: '+2 bonus to Thieves\u2019 Tools checks.' }
],
  foreshadowing: [
  { id: 'f1', text: 'Locke specifically wanted five people', act: 'Act 1', notes: 'The ritual requires five souls.' },
  { id: 'f2', text: 'Locke\u2019s gloves / inverted hands', act: 'Act 1', notes: 'Rakshasa have backward-facing palms. The gloves hide this.' },
  { id: 'f3', text: 'Locke doesn\u2019t eat or drink', act: 'Act 1', notes: 'Subtle tell \u2014 fiends don\u2019t need mortal sustenance.' },
  { id: 'f4', text: 'The Insight check revealing something \u201Crehearsed\u201D', act: 'Act 1', notes: 'DC 20. L\u00F3m\u00EB best at +6 (needs 14). Martin +4 (needs 16). Jean has \u22121.' },
  { id: 'f5', text: 'The Arcana check on the box revealing \u201Cfive lives\u201D and blood magic', act: 'Act 4', notes: 'DC 18 for full truth, DC 14 for basic information.' },
  { id: 'f6', text: 'The Religion check revealing binding ritual / Pashupatastra connection', act: 'Act 4', notes: 'L\u00F3m\u00EB gets advantage (Kelemvor, god of the dead).' },
  { id: 'f7', text: 'The ritual circle has five points', act: 'Act 6', notes: 'Auto-noticed \u2014 three PCs have passive Perception 16.' }
]
};
