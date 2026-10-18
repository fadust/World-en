// world-engine-rules-loader.js — 世界引擎全部规则
// 规则按 UI 面板区块分模块，共 12 个模块
window.WORLD_ENGINE_RULES = (function() {

  // ===================== 规则原文 =====================

  const RULES = [
    // ========== 模块一：世界运转 ==========
    {
      comment: 'Module 1: How the world runs',
      content: `<world_engine>
The world is alive. People outside {{user}}'s sight are living their own lives.

1. Core principle (the world has no center)
This world is an ecosystem that runs on its own. {{user}} is one participant in it, not the center of the world.
- NPCs have their own life goals, schedules, social circles and feelings, and do not revolve around {{user}} for no reason.
- Event chains, news, group progress and so on advance automatically even when they have nothing to do with {{user}}.
- Ongoing world trends are world-level constraints that every evolution round must take into account.
- When generating plot, the AI should put the world's independent running (background evolution) first, and {{user}}'s involvement and perception second.
- {{user}} can see the whole world through the panel (the player is all-knowing), but the protagonist can only perceive what concerns them or what they happen to run into.
- Never assume "everything has to do with {{user}}". Events unrelated to {{user}} are the norm of the world, not the exception.

2. Perception boundaries
- The panel records the world state visible to the player; it does not mean {{user}} or NPCs already know it.
- Characters in the story may act only on what they have seen with their own eyes, heard with their own ears, or learned through valid spreading, communication, reports, investigation, organizational orders or actual contact.
- Distant, secret or unspread states, or states that exist only in the panel, must not enter a character's awareness directly; they must first pass through a plausible path such as news, active contact, an event chain erupting, changes in goods or prices, blocked transport, communication, reports or investigation before they can affect reactions in the story.

3. Evolution rounds and the sense of time
Each World Engine call is one background evolution round; it is not the same as each round of conversation in the input context. Before evolving, estimate for yourself how much story time has passed "since the last world-state update", based on new plot, scene pacing, effort spent, distance traveled, and clues such as waiting, resting, talking, fighting or running errands. That time may be a moment, a few minutes, several hours, several days or longer, or there may be almost no noticeable passage of time.

Background changes must match this estimated span of time:
- When little time has passed, absent characters usually react only slightly or immediately; long-term plans, cross-regional spreading, and the economic and faction structure should not change much.
- When more time has passed, absent characters can carry on with their schedules; news, event chains, factions and the economy may change in proportion to the timescale.
- Event chains still advance on the baseline given by the dice system, but the API must judge, from the story time that actually passed this round and the new facts, whether to keep it, slow it down, stall it, or rewrite it for clear causal reasons.
- News is updated only from new spreading nodes this round, changes in reach, or continued buildup; announcements and reports usually stay stable, rumors may exaggerate or distort, and public sentiment may turn with new information.

The focus of each round is "what changed compared with the last world state". Old conversation in the input context serves only as background and causal basis; never treat history that has already been processed as new change again. The result of the round should show in the panel's world digest; if this round's time span is short and there are not enough new facts, the digest may say the situation is basically stable or only slightly changed.

4. Naming regions and factions
When geographic locations or areas of control are involved, use specific names; never use vague words like "the whole city", "the whole country" or "some faction".
- If the setting already defines cities, countries or factions, use them (e.g. "the capital, Aldmere" or "the Northern Kingdom").
- If not, the AI should create plausible names itself, keep them consistent, and fit them to the setting.
- The reach of news, the area affected by event chains and descriptions at long range all follow this rule.

</world_engine>`
    },
    // ========== 模块二：事件链 ==========
    {
      comment: 'Module 2: Event chains',
      content: `<event_chain>

1. Two types of event chains

Event chains come in two types: conflict and progress. Once an event's type is set it must not change; later updates to the same id must keep the original type. If an R&D effort has already produced a conflict that can evolve on its own, or a conflict has already started an aftermath project that can advance on its own, create another event chain and record the transmission between them in the influence chain.

[Generalize first: identify the main matter, then decide whether to create]
An event chain is not a list of facts, task steps or news headlines, but a main matter that needs tracking across rounds. Before creating a new event, compare it with existing events by core goal or conflict, main parties and continuous process.

If the new content still deals with the same goal or conflict, or is only preparation, execution, communication, movement, investigation, testing, an obstacle, a cost, a partial result, spreading or aftermath of an existing matter, keep the original id and update desc, stage, level or stall; do not split it into a new event. Sharing the same time, place, participants or area of effect can only help the decision; it cannot decide a merge by itself.

Whether to create another event chain depends mainly on whether the new content centers on a core goal, conflict or ongoing action different from existing matters. Even a matter still at the stage of planning, probing, an early investigation or a conflict just appearing may get an event chain as long as concrete signs have appeared and it can keep developing; there is no need to wait until the course of action, resources or the line between success and failure are fully clear. If the new content is clearly just a step in carrying out an existing matter or its direct consequence, prefer the original chain. A new lasting actor, resource system or line of responsibility can be grounds for splitting, but is not a hard requirement.

A different event type is not by itself a reason to split. Ordinary disputes, accidents or local clashes can still be obstacles to a progress event; ordinary repairs, treatment or aftermath can still be results of a conflict event. Only when a conflict or undertaking can evolve on its own should separate chains be created, with influenceChain recording the transmission.

[Admission: event chains record only main matters that can evolve]
Actions, conflicts, plans, results, changes or later effects that appear in the narrative do not automatically become event chains. events records matters that have already shown traceable signs and may continue to develop, be blocked, change direction or wind down later. A matter may be at an early stage; as long as it is not just a one-off action that happens in an instant and shows some chance of continuing, it can be added as an event chain to keep watching.

When the following signs appear, consider creating an event chain; you do not need to prove several possible futures in advance:
1. Concrete words or actions, initial plans, probing moves, signs of investigation, preparation of resources, an ongoing conflict or other traceable grounds have appeared.
2. At least one of the actor, the target or the area of effect can be identified; the rest being unclear does not stop the matter from entering an event chain at an early stage.
3. The matter has reasonable room to develop further. Even if it is not certain to span several rounds, there is no need to wait until it is fully mature to create it.

Pure expressions of emotion, guesses with no real signs, and one-off matters that have clearly ended with no room to continue usually need no event chain. Unfinished actions in the active scene belong to the story, not autonomous event progression. Nearby actors may approach, call out or create external pressure, but stop before deciding scene participants' responses or the outcome of contact. Independently developing background consequences may form a chain. Clear partial steps of an existing matter go into the original chain first. Other effects that need no chain may use other output fields, but the same foreground boundary applies there; never move an unsupported outcome into the digest, news or influence chain.

Erupted/Completed are in principle used to close existing event chains. If a major matter identified for the first time still has unresolved goals or an ongoing process, create it as a non-final event according to its actual progress; if only its consequences continue and the matter itself has closed, do not create an event chain.

1. Conflict — for chains of tension that roll toward eruption, such as revenge, wanted notices, factional friction, pursuit, war and purges.
The normal order is fixed: Brewing → Escalating → Imminent → Erupted.
  - Brewing: the conflict has just shown signs; only a few have noticed, and there is no public pressure yet.
  - Escalating: the conflict is spreading; organization, manpower, rumors or motives for revenge are gathering.
  - Imminent: the conflict is about to turn into concrete action or direct impact; it is close to the breaking point.
  - Erupted: the conflict has played out; pursuit, wanted notices, armed clashes, blockades, purges and the like have already happened.
  - Dissipated: the conflict has lost its motive, actors, resources, target or timing, and it is certain it will not erupt. Not a normal stage; only the AI can set it directly, based on clear causes.
For conflict, level means intensity and runaway potential; the higher the Lv, the easier it advances.

2. Progress — for chains of work that roll toward completion, such as R&D, construction, training, investigation, sending people on errands, opening trade routes, raising resources and institutional reform.
The normal order is fixed: Preparing → Underway → Critical → Completed.
  - Preparing: resources, manpower, materials, intelligence, routes or plans are being prepared; it has not fully started.
  - Underway: the matter has actually begun, with ongoing investment, visible activity and staged costs.
  - Critical: close to the result; most vulnerable to interference, being snatched away, reversal, delay or paying a price.
  - Completed: the result has landed and entered the world state; it may produce follow-up events, news, economic or faction changes.
  - Failed: it is certain the matter cannot be completed because the actors withdrew, resources ran out, key conditions were permanently lost, it was effectively countered or its time ran out. Not a normal stage; only the AI can set it directly, based on clear causes.
For progress, level means difficulty and scale of impact; the higher the Lv, the harder it advances.

2. How advancement works (driven by both local dice and the API)

Each stage of each event chain has in-stage progress stageRound: 1-8; reaching 9 advances it to the next stage.
- Each round local dice propose progress only for previously world-owned chains. The stage/stageRound shown may include this proposal, with evolveResult marking Success/Setback/Hold. It is not an established story fact. Reassess resolution against the latest scene on every update: "world" for independent developments, "story" for developments whose outcome depends on the active scene. Missing resolution discards the update and the proposal.
- For world-owned chains, you may keep or adjust the proposal using elapsed time and causal logic; legitimate terminal states remain protected. For story-owned chains, the local proposal is discarded: report only changes already established in the latest AI story reply, with a supporting verbatim storyEvidence quote. Otherwise return id, name and resolution="story" alone to hold the chain. A nearby interruption does not authorize inventing a reply, injury, completed task, departure or knowledge transfer. Independent off-screen actors and projects remain autonomous.
- You may set any final outcome directly based on clear causes, including the positive outcomes "Erupted" (conflict) / "Completed" (progress) — when the story has already reached eruption or completion, you may set it directly without waiting for the dice to climb step by step.
- The two negative outcomes, "Dissipated" (conflict) and "Failed" (progress), can only be set by you; the dice never set them.

3. Event chain levels

[Conflict levels]
- Lv.1 Personal friction: arguments, ordinary fights, petty theft. Can grow at most to: revenge by those involved and their direct superiors or relatives. Worst consequence: a beating, paying damages.
- Lv.2 Local conflict: seriously injuring someone, wrecking a shop, public humiliation. Can grow at most to: the neighborhood or a single ordinary group. Worst consequence: a local bounty, a gang hunting them.
- Lv.3 Regional upheaval: killing a core person, massacring civilians, blowing up facilities. Can grow at most to: the whole city or several top factions. Worst consequence: wanted across the city, a fight to the death.
- Lv.4 World crisis: assassinating a ruler, destroying a city. No limit on how far it can grow.

[Progress levels]
- Lv.1 Personal / small matters: one person or a few can finish it, with low resource needs. Examples: asking around for ordinary news, repairing gear, making a common remedy, sending someone with a letter, hiring temporary help.
- Lv.2 Local undertakings: need steady manpower, materials, routes or a small organization. Examples: setting up a temporary base, improving a formula, training a squad, arranging an infiltration, opening a short supply route.
- Lv.3 Regional plans: need several organizations, key people or scarce resources working together. Examples: building a large workshop, developing military technology, turning a key figure, deploying a regional spy network, moving large amounts of supplies.
- Lv.4 World / state-level projects: very large, long-term, cross-regional plans or plans that change the power structure. Examples: forging a nation-guarding artifact, establishing a new system of government, rebuilding a continent's trade routes, developing game-changing technology, mass migration and city-building.
Progress level means difficulty and scale of impact, not danger. The higher the Lv, the slower the advance and the greater the resistance.

4. Privilege adjustment rule

When the victim's status or power is higher than {{user}}'s, the event's actual level gets a "privilege jump":
- If the victim is a [core person / privileged class / top official]: every Lv.1 act automatically jumps to Lv.2 (e.g. talking back to the powerful = a serious crime); every Lv.2 act automatically jumps to Lv.3 (e.g. injuring someone powerful = wanted across the city).
- If the victim is a [top faction leader / royalty]: any offense starts at Lv.3 or even Lv.4.
- Conversely, if {{user}}'s power and status are far above the victim's, power can force the event's level down.

5. Dissipation, failure and stalls

Event chains are not fate. An event chain can stall, and it can reach a negative outcome. The AI must not break world rules or the balance of factions just to advance an event chain.

[Stall vs. negative outcome]
- Stall: it cannot advance right now, but a reasonable condition for resuming still exists. Set stall=true, keep the current stage, and write the condition for resuming in desc.
- Dissipated: the conflict has permanently lost its motive, actors, resources, target or timing. Set stage="Dissipated" directly.
- Failed: the matter has permanently lost the conditions for completion, or its goal can no longer be reached. Set stage="Failed" directly.
- Merely going several rounds without progress is not enough to decide Dissipated or Failed.
- Erupted, Dissipated, Completed and Failed are all final; once reached they must not go back to a non-final stage. To start again, create a new event chain.

[Conditions for dissipation / failure / stall (any one)]
1. Physical block: the acting party cannot physically reach the target
2. Not capable enough: the acting party lacks the strength or resources for the current stage
3. Broken information: the acting party has lost track of the target and has no valid way to regain it (bound by the iron law of information spreading)
4. Resources exhausted: the acting party has run dry and cannot go on
5. Countered: {{user}} or a third party has successfully carried out an effective counter
6. Expired: the event chain was time-limited and died out naturally when time ran out

6. Ability, path and reachability
Event chains must advance in line with the acting party's real ability, resources, information, geographic distance, organizational efficiency and outside resistance. An event chain does not gain conditions automatically because it "needs to advance".
If the acting party temporarily lacks necessary conditions, the event chain should stall, slow down, shift to preparation, or go to a failure / dissipation check, rather than being forced forward.

Prohibited:
- Never give the acting party ability, resources, intelligence or range of action beyond its setting just to advance an event chain.
- Never let the acting party ignore geographic distance, environmental danger, faction borders, broken information or physical barriers.
- Never conjure key conditions out of nothing; key conditions must come from existing state, explicit actions, news spreading, investment of resources, help from allies, progress in investigation or a reasonable buildup of time.

[Alternative behavior during a stall]
A stalled event chain does not vanish in place. The acting party can switch to low-intensity preparation that matches its ability: gathering information, building up resources, seeking help, waiting for conditions to change, adjusting goals or changing routes. desc should state the reason for the stall and the condition for resuming.
</event_chain>`
    },
    // ========== 模块三：势力 ==========
    {
      comment: 'Module 3: Factions',
      content: `<factions>

1. Admission for creating factions (mandatory)
A group of people appearing in the narrative does not automatically become a faction. Create a new faction object only when all of the following are met:
1. It has a stable name or a shared identity that can be recognized over time.
2. It has shared interests, goals or things it protects; its members did not just gather by chance.
3. It has at least minimal organization, decision-making or coordination, and can act as a whole.
4. It can persist across rounds and affect the world.
5. It must be an outside collective that can run independently of {{user}}.

Temporary onlookers, one-off caravans, ordinary guests, stragglers, temporary traveling companions, unorganized commoners or "everyone in some place" must not be created as factions. If fewer than 3 qualifying factions exist in the current world, never invent factions to make up the number. Every formal faction should have a name, things it protects, things it rejects, a level of aggression, an internal power structure and an information network; anything lacking these stays in the narrative only.
{{user}}'s own followers, crew, temporary team, directly held assets or organizations fully controlled by {{user}} are not created as factions.
Update an existing faction only on real change: return it only when its goal, area of control, core person, relations, status or pillars of power really change. Ordinary day-to-day operation must not fake field changes. When a faction completely disbands, is absorbed or loses the ability to act as a group, reflect it clearly as "Collapsing"; never keep treating an organization that has disappeared as an active actor.

2. How groups behave
Trigger → spread → discussion → decision → action.

3. How {{user}}'s relationship with groups evolves
- Fits what they protect → they court {{user}}.
- Touches what they protect → hostility.
- Fits what they reject → they push {{user}} out.
- Shows value → private contact.
- Takes sides → wins one side, loses the other.

4. Groups are not monoliths
There should be different voices and factions inside. A core person's personal aims may differ from, or even run against, the group's overall goals.

5. Faction fields (output every round)
Describe each faction every round with these fields:
- id: existing factions keep the id assigned by the system; new factions must explicitly use null, never omit it
- name: faction name. A rename, change of banner or new title does not change the id; only a faction that truly splits off gets a new object
- scope: the geographic area the faction directly controls or strongly influences
- status: overall fortune — "Ascendant"/"Stable"/"Infighting"/"Beleaguered"/"Declining"/"Collapsing".
  Ascendant = money, people and power, solid as iron inside. Stable = running normally with no major crisis. Infighting = factional struggle inside or discord among core people, but the structure still holds. Beleaguered = resources exhausted or under outside blockade, hanging on. Declining = losing pillars, territory or core people, sliding toward collapse. Collapsing = only awaiting the final confirmation; it exists in name only.
- relation: the faction's attitude toward {{user}}, seven levels (with "Neutral" in the middle) — "Blood pact"/"Ally"/"Friendly"/"Neutral"/"Cold"/"Hostile"/"Sworn enemy".
  Blood pact = absolute trust, bound in life and death; Ally = equal standing, mutual support; Friendly = approves of {{user}}, prefers to cooperate; Neutral = neither cares nor objects; Cold = has noticed but does not plan to act; Hostile = open opposition; Sworn enemy = a fight to the death.
- currentGoal: current goal text
- core_person: name of the core person
- powerPillars: the faction's current pillars of power, at most 3, each a name of 1-3 words (e.g. "Military deterrence"/"Court connections"/"Treasury backing"/"Popular support"). List only pillars that are stable, effective and carry real power; pillars that have collapsed or failed must not be kept.
※ For a temporary family revenge group, write core_person as "None (led by: XXX)".

6. Relations between factions
Describe relations between factions with a fixed vocabulary, using only these 7 levels: Blood pact, Ally, Friendly, Neutral, Cold, Hostile, Sworn enemy. Vague words outside these levels are not allowed.
How relations evolve: joint action → relations improve; conflict → relations worsen; {{user}} mediating or sowing discord → can change relations.
Effects of relations: allies share information and support each other; hostile factions may clash openly, affecting event chains.

7. Mandatory intervention
Intervention is mandatory when: relation becomes Hostile or Sworn enemy; {{user}} significantly affects a group's progress; group members make active contact; the economy drops a faction's status to Beleaguered or Declining (then it must intervene next round).

8. Core persons
Every formal faction must have at least 1 core person holding power. A core person must hold real power or resources.
- [World Info first] First look for supporting characters already defined in the character card; if their social standing matches a group leader, promote them directly.
- [Create your own] If no defined character matches, create one with a name, position, personality traits and personal aims.
- [Personal aims] A core person's personal aims may match the group's goals or run against them.
- [Effect of power] The core person holds the group's highest power. Their death will throw the group into infighting, a split or dissolution, or trigger an enemy event chain.

9. Pillars of power and power collapse
Every formal group must declare the powerPillars it currently has, at most 3, each a name of 1-3 words (e.g. "Military deterrence", "Court connections", "Treasury backing"). List only pillars that are currently stable and effective; collapsed or failed ones must not be kept.
Pillar changes must be written into influenceChain, explaining which pillar was destroyed, shaken or newly established by which event.
{{user}} can destroy a core person's pillars of power one by one through event chains. Each pillar destroyed lowers their actual control, and the group's status should reflect this.
Once all pillars are destroyed, the person loses power and their status as a core person. If killed then, it no longer triggers type=blood and is handled only as "an ordinary member was killed" in the enemy roster module (type=grudge).
</factions>`
    },
    // ========== 模块四：风声 ==========
    {
      comment: 'Module 4: News',
      content: `<winds>

News is the public talk spreading through the world, the information layer between events, factions, the economy, reputation and active contact. It is not a record of objective truth, and not a meaningless list of atmosphere.

1. News structure
- id: existing news keeps the id assigned by the system; new news must explicitly use null, never omit it.
- topic: news topic. The same line of spreading may be renamed as the claims or focus change, but must keep its id; never create duplicate near-synonymous entries.
- type: "announcement"/"report"/"rumor"/"sentiment", meaning an announcement, a report, a rumor or public sentiment.
- level: actual scale of spreading. Lv1 = a few people in a circle; Lv2 = local; Lv3 = a province, state or other large region; Lv4 = national, international, the whole world.
- content: the specific claim now in circulation.
- scope: the specific region or circle it has actually reached so far.
- source: the source and chain of spreading. When it involves {{user}}, write out the full chain of information.

2. Merge first
News records an "information topic" in circulation, not a list of facts, details, versions or follow-up headlines. News can be true reports, rumors, misinformation, exaggeration or partial understanding; truth or falsehood does not rule it out.
Before creating news, first decide whether the new information belongs to the same topic as existing news.
If they share the same core subject, core event or matter, core claim, meaning in circulation or social target, update the existing news; do not create a new one.
Additions, further spreading, more details, a wider scope, a change of tone, version drift, a change in credibility, rising emotion or spreading effects of the same topic should all be merged into the original news by updating content, level, scope, source and other fields. Never create duplicate news just because the headline, wording, a version suffix or the stage of spreading changed.
Only when the core meaning in circulation of the new information has changed and points to a different subject, judgment, interest, risk assessment or group action may new news be created.

3. Limits on generation
- News can be created once a specific piece of information has been publicly released, retold by witnesses, passed on through real channels, begun circulating in a small circle, or become recognizable group discussion. Spreading may be at its very start; it need not have reached a large scale.
- New news should have a clear information topic and at least some value in spreading, such as being likely to draw others' attention, discussion, judgment or response, or still having room to be retold, spread or distorted. It need not have actually changed character actions, reputation, the economy, factions or event chains, and need not be proven in advance to last several rounds.
- Private letters, secret orders, secret intelligence and other information with only specific recipients are not news; create news only after it leaks and starts spreading.
- A single offhand remark nobody heard or retold, ordinary small talk, idle chatter with no clear topic, pure atmosphere, and mechanical repetition that brings no new information usually do not create news.
- "The matter is big" does not by itself mean "it has spread". If there has been no public release, no one else has heard it, and it has not been retold, passed on or discussed together, do not create news even if the matter is important enough. An announcement that has been formally released counts as the start of spreading by itself.
- Never force news every round, and never fill space with placeholder news like "the world is calm, nothing major".
- An announcement only proves the publisher said it publicly, not that it is true; a rumor may also happen to be true. News uses no credibility or heat fields.

4. Spreading and escalation
- Each round, check whether existing news gained new valid spreading nodes. Without spreading nodes, level and scope stay the same.
- News with no real update for several rounds in a row will be judged faded by the local system and deleted directly before the next background evolution.
- If a news item is still spreading, mutating, widening its scope or still affecting the world this round, you must return an update with the same id; merely repeating it unchanged does not count as an update.
- News lifetime and fading are managed by the local system; never output or manipulate internal counters.
- News can spread instantly within the same scene; within the same region it usually takes 1-2 rounds; across regions it usually takes 3-5 rounds; broadcasts, networks, magical communication and the like within the setting can shorten this.
- level only shows the scale of spreading, not how important or true the matter is.
- Announcements and reports usually keep their content stable as they spread; rumors may exaggerate, distort or branch; public sentiment can turn with new information.
- News can stay at its level for a long time, but there must be continued spreading or influence to justify it.

5. Cross-system linkage (mandatory)
- An actor may act on news only after it has spread into the area or circle where that actor is.
- News can change a faction's goals, allocation of resources or attention to {{user}}; it can trigger, advance, delay or end event chains; it can change reputation; it can lead to investigations, contact, blockades, panic buying and similar actions.
- Major economic signals should produce matching news, and the public acting on news can in turn change the economy.
- Actions involving {{user}} can change a circle's reputation only after they form news that reaches that circle.
- An enemy may track based on leads only after learning of them through news reaching its intelligence sources or other valid channels.
- Whenever news causes a cross-system change, it must be written into influenceChain, making clear "which news → who learned of it → what action they took or what judgment they formed".
- News with no real spillover effect only updates itself; never force linkage.
</winds>`
    },
    // ========== 模块五：影响链 ==========
    {
      comment: 'Module 5: Influence chains',
      content: `<influence_chain>

influenceChain records how important changes spread through the world. It is not a new event chain, takes no part in dice advancement and does not show stage progress. It answers "what triggered the change, what it directly changed, and what aftermath followed".

1. Effects that can be recorded
- Effects of event chains on news, the economy, reputation, faction actions and NPC contact
- Long-term constraints of world trends on event chains, faction actions, the economy and news
- Effects of spreading news on faction judgments, public attitudes and official actions
- Effects of economic changes on resources, prices, ability to act and faction plans
- Effects of reputation changes on the attitudes and active contact of NPCs in different circles
- Effects of black-box information leaking or not leaking on outside awareness, lines of investigation and wrong judgments
- One event chain speeding up, slowing down, redirecting, dissipating or failing another event chain

[Admission]
Create an influenceChain only when the trigger has already made a real change to another system's lasting state. All of the following must be met:
1. trigger is a clear source that has already happened or taken effect.
2. impact is a direct change that has already happened and can be observed or verified, not a guess.
3. The change crosses at least two systems, or makes another lasting entity change its goals, status, resources, reach or actions.
4. This transmission is truly necessary to understand later world states.

Mere possibilities, changes in emotion or atmosphere, ordinary internal steps of the same matter, an event chain's own regular progress, and textual links between fields with no real change in state must not create an influence chain. "May lead to something later" cannot serve as impact; trends with causal grounds that have not happened yet may only go into fallout.

2. Three-part structure
Every influenceChain must use the three-part structure:
- trigger: the source. The specific event, action, world trend, news, economic change, reputation change or black-box information that caused the change.
- impact: the direct effect. What world state the trigger has actually changed.
- fallout: the aftermath. Secondary changes or next-step trends after the effect spreads further.

3. Prohibited
- Never use influenceChain as a new event chain to create stage or stageRound.
- Never stuff the full play-by-play of ordinary event progress into influenceChain; record only when there is cross-system spillover.
- impact must be a direct change that has already happened; fallout must be aftermath produced as that effect spreads further, and must not restate the trigger.
- Never use influenceChain to leak black-box information to NPCs who do not know it.
- When the same trigger already has a record, update that record; do not stack duplicate records endlessly.
- Update the same record only when the direct effect or aftermath really changes; do not return it again in different words.
- Once the transmission is complete and there is no new aftermath, stop updating it. An influence chain is a time-limited causal record; never extend it into a permanent event chain.
</influence_chain>`
    },
    // ========== 模块六：信息传播与知情边界 ==========
    {
      comment: 'Module 6: Information spreading and knowledge boundaries',
      content: `<contact_and_info>

1. Knowledge boundaries
NPCs, factions, black markets and enemies cannot read save files, and cannot read panel information. Before letting anyone learn a piece of information, the AI must be able to answer: "By what path did they learn it?" If it cannot answer, treat them as not knowing.

Valid paths to learning include:
- Seeing it with their own eyes or hearing it with their own ears.
- Being told directly by someone who validly knows.
- Public information such as announcements, notices and public declarations.
- News that has already spread into their area or circle.
- Their organization's intelligence network covering the information, with a reasonable time for it to travel.
- Physical evidence or traces at the scene being investigated and interpreted by someone capable.
- Communication, surveillance, tracking, divination or similar means that clearly exist in the setting and that they are entitled to use.

Prohibited:
- No "the NPC just knows".
- Never leak panel information directly to characters.
- Never replace a specific spreading path with "word travels fast" or "someone heard about it".
- Never let anyone who has not touched the chain of spreading act on it.

2. Traces are not pointers
Physical evidence, traces and hearsay can usually only prove "what happened", not automatically "who did it".
To point an event at {{user}} or at a particular identity, there must be additional linking evidence: identification by witnesses, unique features, unique items or skills, voluntary disclosure, traceable records, results of a long investigation and so on.
Without linking evidence, NPCs can only form vague judgments, wrong guesses or open questions to investigate, and must not lock onto {{user}} directly.

3. Identity separation
{{user}}'s anonymity, aliases and disguises are separated from their true identity by default. Only after valid linking evidence appears can others connect the two identities. Intelligence organizations, black markets and enemies must follow this rule too; "good at intelligence" only means they can start investigating more easily, not that they automatically know everything.
</contact_and_info>`
    },
    // ========== 模块七：声誉 ==========
    {
      comment: 'Module 7: Reputation',
      content: `<reputation>

1. Four-dimensional reputation
{{user}}'s reputation is split into four independent dimensions, each with 5 levels, rising and falling independently without canceling each other out.
- The halls of power: how the established powers in charge view {{user}} — a royal court, parliament, corporate board, church, federation and so on. Standard: law-abiding or lawbreaking, useful or dangerous, compliant or defiant.
- The streets: {{user}}'s standing among ordinary people, townsfolk and street opinion. Standard: kind or brutal, generous or greedy, protector or threat.
- The underworld: how forces outside the system see {{user}} — outlaws, smugglers, mercenaries, independent hackers, fixers, underground gangs and everyone else who doesn't make a living above board. Standard: not whether you break the law, but whether you have guts. Those who dare use private force against systemic injustice are respected; those who only dare bully the weak are despised.
- Among peers: how fellow members of {{user}}'s trade or profession rate them. Standard: skill, whether they keep the trade's rules, whether they contribute to their peers.

Five levels (shared by every dimension, low to high): Reviled → Notorious → Unknown → Respected → Revered
The midpoint is "Unknown"; the two levels below are negative (Notorious, Reviled) and the two above are positive (Respected, Revered).

[Admission for change]
Reputation is not a score for behavior but the group view a circle has already formed. Adjust a dimension only when both "the action or result has validly spread to that circle" and "the information is enough to change that circle's overall judgment of {{user}}" are met.
A single NPC's liking, dislike, gratitude or grudge belongs in personal or faction relations; without forming a circle-wide perception it must not be written into reputation. Slight courtesy, ordinary trades, everyday wins and losses, and old matters spread again are usually not enough to cross a reputation level.
Return reputation only when new facts appear that are enough to change the current level; without real change, do not use lastChange to fake an update. A reputation dimension does not reset just because nobody is talking about it for a while; it can only be changed later by new, spread group views.

2. Principles for judging reputation
A reputation change is not a behavior score but "a change in the overall view a circle forms after learning information". Judge in this order:

1. Spreading first
   The action, result or rumor must already have reached the circle through valid news; actions that have not spread, are known to only one person, are known only to the victim or are still in the black box do not change the four dimensions.

2. The circle's point of view
   The same fact can be judged differently by different circles:
   - Halls of power: order, legitimacy, stable rule, institutional authority.
   - Streets: people's safety, livelihoods, sense of fairness, whether someone is a menace to the area.
   - Underworld: loyalty, nerve, resisting injustice, whether someone oppresses the weak; plain crime earns no automatic credit.
   - Peers: skill, the trade's rules, contributions to the field, trust among peers.

3. Group view
   Reputation records only the overall view at circle level, not a single NPC's liking, gratitude, fear or grudge. A grudge inside a single group belongs in factions, enemies or other relations, and does not directly change overall reputation.

4. Strength of change
   Adjust reputation only when new information is enough to change the current level. Slight courtesy, ordinary trades, everyday wins and losses, repeated old news or new details that have not spread should not change the level.

5. Limits on multi-dimensional effects
   One fact can affect several dimensions, but each must fit that circle's logic of judgment; usually no more than 3 dimensions. Never force changes in several dimensions just to make the panel richer.

3. Different observers look at different dimensions
A newly generated NPC or group's initial attitude reads the dimension of the circle it belongs to:
- Court / the powerful / the ruling class → read [The halls of power]
- Commoners / ordinary people / townsfolk → read [The streets]
- Outlaws / the underground / people outside the system → read [The underworld]
- Peers / the same profession / kindred spirits → read [Among peers]
- People who cross circles (e.g. a court spy inside the underworld) → combine the two dimensions

4. Compound reputation effects
- High in both halls of power and streets → "The People's Choice" event chain (chances for official honors / popular acclaim)
- High in both streets and underworld → "Champion of the People" event chain (commoners and outlaws alike see {{user}} as a hero, which makes the court nervous)
- High in both underworld and among peers → "Hero of the Land" event chain (connections on both sides; outlaws and peers alike give you respect)
- High in halls of power + high in underworld → "Double Life" event chain (exposure risk builds up over time)
- Any dimension falling to Reviled → a "wanted / hunted / banished / blacklisted" event chain within that circle

</reputation>`
    },
    // ========== 模块八：经济 ==========
    {
      comment: 'Module 8: Economy',
      content: `<world_economy>

The economic pulse is the world's circulation, not {{user}}'s personal ledger. It tracks the overall economic climate and notable changes in the market.

1. Economic climate

climate is the current region's economic temperature, described with four words:
- Booming: brisk trade, safe trade routes, prices stable to high
- Steady: business as usual, prices shifting naturally with the seasons
- Recession: shrinking demand, businesses closing, a few essentials soaring in price
- Turbulent: war, disaster or blockade has broken economic order; barter returns

The scope of climate is {{user}}'s current region and the economic sphere directly tied to it. The economic temperature of distant places is added through signals.

2. Market signals

signals records notable economic changes in the market now. Tracking standard:
- The change is enough to affect faction actions, NPC decisions or the course of event chains
- It is not an everyday fluctuation — everyday fluctuations don't belong in signals
- Usually no more than 3

Each item contains:
- summary: one sentence describing the change and its effect
- scope: geographic area affected (a specific region name, not "everywhere")

The AI must give every signal a cause: behind every change there must be a traceable event chain or outside reason (weather, war, interrupted trade, new technology, hoarding, speculation). No baseless swings.

[Creating, updating and removing]
- Create a signal only when the change has already happened in the market, logistics, supply and demand, prices or resource allocation; a mere forecast like "prices may rise / there may be shortages" must not be saved.
- Update the original signal for the same economic change; do not create near-synonymous duplicates because of wording, another name for a place or wider consequences.
- Update only when the size, scope, cause or effect on actions really changes.
- When the market returns to normal, the effect has been absorbed or the change no longer affects any decision, remove it from signals; do not keep it forever as old news.
- Change climate only when the region's overall economic temperature truly crosses a level; a change in a single commodity or a single shop usually only goes into a signal and cannot stand for the whole economic sphere.

3. Linkage with news and event chains

- Major changes such as soaring prices or depleted supplies → produce at least 1 economic report or public sentiment item (see Module 4).
- After people learn of economic news and act on it by panic buying, hoarding or pulling out money, they can in turn change the economy and event chains.
- Never let economic information reach the whole city instantly regardless of distance — the scope of signals and the scope of news must match.

4. Linkage between the economy and event chains

- A serious signal in the same direction for several rounds in a row → the API should create a progress event chain showing local attempts to fix it (opening new trade routes, finding substitutes, and so on).
- A major economic change → affects relations between factions (tension rises between those harmed and those who benefit).

5. Prohibited

- Never track {{user}}'s personal wallet or backpack. This is a world engine, not a bookkeeper.
- Never put everyday small fluctuations into signals.
- Never let prices swing for no reason.
- Never make every region's economic trend exactly the same.
</world_economy>`
    },
    // ========== 模块九：仇敌录 ==========
    {
      comment: 'Module 9: Enemy roster',
      content: `<enemies>

An enemy is an irreversible personal grudge caused by concrete harm {{user}} did. The defining traits of an enemy are that it never fades and it tracks across regions. It is something entirely different from faction-level hostility (factions.relation) — faction hostility comes from stances and interests and can be negotiated; an enemy comes from harm and cannot be negotiated.

Every enemy record has a system id. When updating an existing enemy you must keep the original id, even if its name, title or organization name changes; new enemies must explicitly use null, never omit it.

[General rules for creating and updating]
First check the full trigger conditions for a blood feud or non-lethal grudge below; if they are not met, never create an enemy just because a character shows anger, hostility or vows revenge. An enemy is an irreversible personal grudge that needs long-term tracking, not an ordinary list of villains.
Update an existing enemy only when its progress in locating, ability to retaliate, stage of action, organizing body or the fact of its ending really changes; do not just reword the hatred every round. Being temporarily unable to act only changes its action status; the enemy is not deleted automatically.

1. Enemy types
1. Blood feud (type: "blood") — trigger (any one): {{user}} kills a group's core person (except a former core person who already lost power; see power collapse in the faction module); {{user}} causes someone's close family member to die or be permanently maimed.
   Traits: never fades, cannot be negotiated, the motive for revenge never disappears. Even if the avengers run out of resources, the hatred does not fade; it only stalls temporarily for lack of ability.

2. Non-lethal grudge (type: "grudge") — trigger (all must be met):
   - Irreversible harm: {{user}}'s actions caused a major loss that cannot be recovered (crippled in their martial skill, robbed of a life's work, ruined, exiled or stripped of status by a setup, and so on).
   - Clear will for revenge: the victim has a strong, explicit motive for revenge, not a vague "dislike" or "holding a grudge".
   - Ability to track or retaliate: the victim has the means (resources, fighting skill, connections, an intelligence network) to actually track or retaliate against {{user}}.
   Anything not meeting all three is not a grudge. Being insulted by {{user}}, losing one business competition, being hurt in a street fight — none of these qualify for the enemy roster; the AI should show them naturally in the narrative without saving them.
   Traits: also never fades, but is usually less terrifying than a blood feud.

2. Enemy behavior and tracking
- A blood feud supplies motive, not ability. Pursuit is limited by faction level: a weak faction cannot infiltrate a strong faction's territory.
- Tracking across regions takes time. An enemy must first locate {{user}} through valid means (intelligence network, informants, news and so on) before it can organize action.
- When an enemy's status = "Striking", it has a chance to actually launch a hunt or act of revenge only once every 5-10 rounds.
- If the enemy's power < the protecting faction where {{user}} is, the pursuit is forced to stall, switches to "Tracking" and builds strength.

3. Enemy triggers (group perspective)
When {{user}}'s actions trigger type=blood, the AI must decide the group's direction based on who was killed:
1. The victim was a core person of the group (except a former core person who already lost power):
   - Path A (united in vengeance): if cohesion is high and there is a clear successor, the successor becomes the new core and a conflict event chain is created.
   - Path B (infighting): if the group is riddled with factions, it falls into a power struggle; revenge is shelved and the original progress stalls.
   - Path C (dissolution): if cohesion is low or resources are exhausted, the group disbands outright and is removed from the active panel.
2. The victim was an ordinary member (or a former core person who already lost power): create a temporary revenge group named "[victim's name]'s Kin Avengers". Create a conflict event chain.
Whichever path, you must add an entry to enemies and record the transmission in influenceChain.

4. Ending an enemy
Only when {{user}} completely eliminates the enemy (kills the core avengers, destroys the revenge organization) may status="Resolved" be set.
- Resolved entries are kept as a memo for 20 rounds and then cleared automatically.
- After turning the tables, {{user}}'s reputation can recover, but only up to "Respected" (if the reputation module is enabled).
- The matching conflict event chain is marked as ended at the same time.

5. Prohibited
- Never create an enemy entry just for reversible harm such as "insulted by {{user}}", "lost a business competition" or "lightly hurt in a street fight".
- Never treat faction-level hostility (factions.relation = "Hostile") as automatically equal to an enemy.
- Never give an enemy abilities beyond its faction. A weak faction cannot summon strong help out of nowhere, infiltrate strong territory or locate anyone by omniscience.
</enemies>`
    },
    // ========== 模块十：区域突发事件 ==========
    {
      comment: 'Module 10: Regional incidents',
      content: `<regional_incident>

1. Purpose of the system
This system only generates region-level incidents — major events big enough to affect a region.
It does not handle low-value events.

2. Division of responsibility
Whether a regional incident triggers, and which type, is decided entirely by the local system. When the local system does not trigger one, this rule does not ask you to generate a regional incident, and you must not generate one on your own.
Only when the local system triggers one and injects a "regional incident mandatory order" do you generate, for the type the order specifies, the concrete incident title, location, area of effect, the news it spreads and its spillover effects.

3. Incident types
The types below only define the causal category and scale of an incident. The concrete form must fit the current setting, era, level of technology, geography and social system; do not copy the examples.

- banditry, organized raiding: large-scale attacks and plunder against settlements, transport lines, trade hubs, resource stores or traveling groups.
- fire, major fire: a large fire in storage areas, residential areas, production facilities, transport hubs, public facilities or important buildings.
- massacre, atrocious violence: serial killings, mass deaths, major attacks or other violent cases severe enough to cause regional panic.
- flood, flood disaster: abnormal water levels, failed embankments, flooded regions, cut-off transport, settlements or production areas hit.
- infrastructure, infrastructure failure: roads, bridges, water supply, energy, communications, transport or other key public facilities badly damaged or shut down.
- plague, spreading disease: disease, contamination or abnormal infection with a risk of regional spread among people, animals, plants or other applicable life.
- famine, shortage of supplies: regional shortage, cut-off supply or runaway prices of food, water, energy, medicine or other basic necessities.
- riot, mass unrest: large-scale clashes, stampedes, looting or disorder in public places, distribution points, transport hubs or around seats of power.
- rebellion, organized resistance: local groups, armed organizations or social blocs launching sustained resistance, secession or rebellion against existing rule and order.
- military, military upheaval: armed forces mutinying, routing, crossing borders, blockading, imposing martial law, attacking, or other changes big enough to alter regional security.
- earthquake, geological disaster: earthquakes, landslides, collapses, ground fissures, mudslides or other large-scale geological anomalies.
- storm, extreme weather: storms, blizzards, dust storms, cold waves, heat waves or other weather disasters severe enough to disrupt regional production, transport and daily life.

4. Generation requirements for the API
When the local dice trigger and inject a mandatory order, the API must:
1. Generate a region-level incident of the specified type that affects a clear region, road, town, pass, dock or other geographic area.
2. The incident must produce news that can spread.
3. The incident must cause at least one spillover effect: an economic change, a faction action, a change in public order, an event-chain change, a reputation change, a black-box change or a new influence chain.
4. The incident has no direct causal link to {{user}}'s current actions and must not be written as the plot of an existing enemy, existing faction or existing event chain.
5. Do not wipe out the core stage out of nowhere, and do not destroy {{user}}'s core assets without cause.
6. If the incident does not happen in {{user}}'s region, do not forcibly interrupt {{user}}'s current action; treat it only as a background world change, distant news or spreading talk.
7. Never write a "regional incident" as a plot an existing faction planned long ago.

5. Data structure
{
  "regionalIncident": {
    "active": true,
    "title": "incident title",
    "type": "incident type",
    "scope": "area affected",
    "impact": "one sentence summing up the regional consequences"
  }
}
cooldown is maintained locally; the API must not output or modify this field.

6. Minimum API return
After a trigger, return at least regionalIncident, winds and influenceChain. Depending on the situation, you may also return events, economy, factions, reputation and blackbox.
</regional_incident>`
    },
    // ========== 模块十一：信息黑盒 ==========
    {
      comment: 'Module 11: Information black box',
      content: `<secret_asset>

1. What the information black box is (iron law against the god's-eye view)
While the story runs, two kinds of content must be strictly isolated in the [information black box]:
1. Secret actions (secretActions): actions {{user}} completed with no witnesses and no traces (such as killing an ox deep in the mountains, an assassination in a sealed room, a silent infiltration). The key attribute is traces — are there witnesses, is there physical evidence.
2. Secret assets (secretAssets): every resource {{user}} holds secretly and has not shown publicly (such as secret letters, poison, leverage on someone, hidden supplies, planted informants, a secret identity). The key attributes are exposure and usability.
- secretActions field: each item { action, witnesses: "None / only XX" }
- secretAssets field: each item { name, exposure: 0-100, status: "Active/Stale/Exposed/Void" }

[Admission]
Information being unknown does not mean it must go into the black box. Write it only when the knowledge boundary needs protecting across rounds, or its future use or exposure risk needs tracking:
- secretActions: the action has already happened, and "who knows it and what traces it left that can be investigated" will affect future judgments or actions.
- secretAssets: {{user}} actually controls the resource, it has future value to draw on, and its secrecy, exposure or period of validity needs ongoing tracking.

Ordinary inner thoughts, ideas not yet acted on, small moves with no later value, public items, things picked up and used right away, and private matters unrelated to the future world state must not go into the black box. Never put "everything NPCs don't currently know" into the black box.
Update existing entries only when the people who know, traces, exposure, control, validity or use really change. Once an action is public and the knowledge boundary no longer needs isolating, stop maintaining it as an active secret; when an asset is used up, void, out of control or fully public, update its status and stop treating it as a usable hidden card.

2. Checking who knows and the law of physical isolation (highest priority)
1. Physical barrier principle: for content in the black box, every NPC who was not at the scene and not directly involved is by default in a state of "complete, total ignorance", physically isolated from it.
2. No god's-eye view: the AI is absolutely forbidden to turn {{user}}'s secret actions automatically into events everyone knows. For example: if {{user}} kills an ox deep in the mountains, as long as there were no witnesses, then even in the city absolutely nobody knows the ox is dead, let alone that {{user}} killed it.
3. Mandatory check: before describing any NPC (including dialogue, actions, expressions and inner thoughts), the AI must check whether that NPC is on the black box's "list of those who know".
4. Absolute ignorance: if an NPC does not know, the AI must never let them show any hint, suspicion, "double meaning" or "sixth sense". Not knowing means being a blank page; the NPC's reactions must be based entirely on what they currently know publicly.
5. Constraint on reasoning from traces: if {{user}} leaves obvious physical evidence, NPCs can only gain information gradually through concrete "investigative actions" that fit their intelligence and position, and must never "suddenly realize" or "guess" it.

3. How secret assets work
- exposure: 0-100, risk of exposure. 0 = absolutely secret, 100 = fully public. Frequent activity by {{user}}, rising local alert, and showing or hinting to others all raise exposure. At 50 there is a risk of a confrontation or a leak; at 90 it may be seized or made public.
- status: Active/Stale/Exposed/Void. Active = still usable; Stale = intelligence outdated; Exposed = discovered; Void = no longer usable (e.g. supplies seized, informant out of contact, identity seen through).
- How assets evolve: intelligence is time-sensitive and may go stale automatically after related events. A hidden cache's exposure rises naturally over time and faster with activity nearby. Informants and moles can be turned against you once exposed; an exposed identity loses freedom of action. Low exposure + high validity = a safe asset; low exposure + stale = nobody knows, but it is useless; high exposure + void = discovered and written off.
</secret_asset>`
    },
    // ========== 模块十二：天下大势 ==========
    {
      comment: 'Module 12: World trends',
      content: `<world_trends>

A world trend is a long-term situation that has already changed how a nation, the international order or the whole world works. It is not ordinary news and not an event chain waiting to advance, but a world-level constraint other systems must take into account when they act.

1. Data structure
Each item contains:
- id: existing trends keep the id assigned by the system; new trends must explicitly use null, never omit it.
- name: trend name. A change of wording does not change the id.
- scope: actual area of effect.
- status: "Ongoing"/"Ended".
- description: the current situation and how it is constraining actions in the world.
- source: the clear source that formed the trend.

2. Conditions for forming
Each round, check these candidate sources:
- An Lv4 conflict event reaches "Erupted".
- An Lv4 progress event reaches "Completed", and the result changes the national or international landscape.
- The facts behind Lv4 news are widely confirmed and keep affecting several factions.
- A long-term situation has already formed.

A candidate source does not create a trend automatically. Create a world trend only when it is "long-lasting, wide-reaching, cross-system, and forces several factions to keep adjusting their actions" all at once. National festivals, single announcements, short-lived sensations and ordinary major news are not world trends.

3. Persistence and ending
- World trends take no part in the dice, do not dissipate on their own, and are not deleted because a round did not return them.
- Every world trend with status="Ongoing" must act each round as a background constraint on event chains, factions, the economy, news and NPC actions.
- A trend has no effects field of its own. Concrete effects go into the matching systems, and cross-system changes are written into influenceChain.
- Update description only when a fact clearly changes the situation; mark it "Ended" only when the situation has certainly ended.
- An ended trend is a historical result and must not go back to Ongoing; if a similar situation happens again, create a trend with a new name.
</world_trends>`
    }
  ];

  // ===================== 对外接口 =====================

  function loadRules(baseUrl) {
    return new Promise((resolve) => {
      console.log('[World Engine] Rules are built into the JS; total:', RULES.length, 'rules');
      resolve({ count: RULES.length, comments: RULES.map(r => r.comment) });
    });
  }

  function getAllRulesText() {
    console.log('[getAllRulesText] RULES:', RULES.length);
    if (RULES.length === 0) return '[World rules failed to load; no rules are available]';
    const orderedRules = RULES.map(r => `========== ${r.comment} ==========\n${r.content}`);
    return `## World evolution rules (original text, ${RULES.length} rules)

${orderedRules.join('\n\n')}`;
  }

  function getCoreRulesSummary() {
    if (RULES.length === 0) return '';

    const summary = `
[World Engine · story behavior rules]

1. How the world runs and its timescale
- People, organizations, events and environments in the world keep changing according to their own goals. {{user}} is one participant, not the default cause or center of every change.
- Changes outside the current scene can keep happening, but the story should show them only through observable results, plausible contact or the spread of information; characters must never read the panel directly.
- Each world-state update is not a fixed length of time. The story should judge how much time actually passed from clues such as actions, travel, waiting, rest, conversation and conflict; the size of changes must match the timescale.
- The world state records results relative to the last update. Never treat history that has already been processed as new change this round.

2. Events
- "Events in progress" are only independent main matters that need tracking across rounds, not a task list, a news feed or a collection of every fact that has happened.
- Progress events move toward completion; conflict events move toward eruption. Level shows difficulty, intensity and reach; stage and progress show where it currently stands.
- [Success] means progress was made this round, [Setback] means progress went backward or conditions worsened, and [Hold] means the current stage is basically unchanged. The story should reflect that result, but never repeat the label mechanically.
- A pause or stall is not an end. Those carrying it out can still gather information, build resources, seek help, adjust goals or wait for conditions to change.
- Erupted, Completed, Dissipated and Failed are all final. A final result can have later consequences, but the original event must never be written back into a non-final stage.
- Events must develop in line with the acting party's ability, resources, information, geographic distance, organizational efficiency and outside resistance; never conjure conditions that don't exist just to move them forward.

3. Organizations and relations
- Organizations act according to their own goals, resources, internal structure and sources of information, and {{user}} is not their only target.
- An organization's status describes its overall ability to operate; its relationship with {{user}} describes its leanings. Characters' words and actions should fit the current status and relationship, but a relationship label must not make every member behave exactly the same.
- An organization can have different stances, factions and personal goals inside it; a core person's aims need not fully match the organization's overall goals.
- An organization can act effectively only within its area of control or influence. Actions across regions, beyond its authority or through other organizations' borders need time, a route, resources and information.
- Key resources or sources of power decide an organization's real control. When one fails, its status, ability to act and core persons' standing should change accordingly.

4. Global trends
- Global trends are long-term, wide-reaching, cross-system background constraints that force several parties to keep adjusting their actions, not a single event or a short-lived hot topic.
- Ongoing global trends should affect events, organizations, the economy, the spread of information and characters' choices within their reach; concrete effects still have to land in the matching state and scenes.
- Global trends do not disappear because they go unmentioned for a while, and must not be ended on a whim without clear facts.

5. Public information and opinion
- Announcements, reports, rumors and public sentiment record claims in circulation; they are not the same as objective fact. A public release only proves the release happened; it does not automatically prove the content is true.
- An information level shows the actual scale of spreading, not importance, truth or strength of effect; the reach decides which regions, groups and characters may come across the information.
- Information can only widen through actual spreading nodes. Without a new spreading path, nobody outside its reach may judge or act on it.
- The same information topic can gain details, mutate, widen or change its slant; the story should treat this as the same line of spreading developing, not as unrelated new messages.
- Only after information reaches the relevant parties can it affect organizational judgments, economic behavior, social standing, the course of events, investigations or contact.

6. Information spreading, knowledge and identity separation
- Before any character or organization learns information, there must be a clear path: being there, being told by someone who knows, public channels, information spreading that covers them, an organizational network, investigative evidence, or communication and detection means that truly exist in the setting.
- "Good at investigating", "news travels fast" or "a bad feeling" cannot replace a concrete path of information.
- Traces can usually only prove what happened, not automatically who caused it. Pointing a fact at {{user}} or a particular identity needs additional linking evidence.
- Anonymity, aliases and disguises are separated from each other by default; only after valid linking evidence appears can others match the identities.
- Contact, locating and tracking must fit the state of knowledge, path of action, distance, purpose and ability; never arrange them out of nowhere just to create interaction.

7. Economy
- The economy describes a region's overall state and market changes big enough to affect decisions; it does not record {{user}}'s personal money, items or ordinary daily fluctuations.
- A market signal must have already happened, with a clear cause, an actual reach and observable effects; forecasts, possibilities or a single small change cannot be treated as an established market state.
- A change in a single commodity or a local business usually does not mean the whole region's economy has changed. Different regions can show different trends.
- Economic information is also bound by the limits of spreading; changes in prices, supply, logistics and resources should show through concrete scenes and affect the actual choices of those involved.

8. Social standing
- Social standing is divided into four independent circles: official and power, public and popular, informal and underground, trade and professional. Each circle forms its judgment by its own interests and standards, and ratings do not sync with each other automatically.
- Social standing is an overall perception at group level, not an instant score for each of {{user}}'s actions, and not the same as a single character's liking, gratitude, fear or resentment.
- A rating affects characters' reactions only after the relevant information has validly spread to the matching circle and region and is enough to change the group's overall judgment.
- An unknown standing means the circle has not formed a clear perception yet, so treat {{user}} as an ordinary stranger; the strength of a rating must show at its current level and must not be exaggerated.

9. Opposition
- Opposition records long-term personal or group conflicts caused by major, irreversible harm; it is not the same as general differences in stance between organizations.
- Serious opposition supplies a lasting motive, but not automatically the ability to locate, track, infiltrate or act. Actual action is still limited by resources, information, distance and other organizations' borders.
- Being temporarily unable to act does not mean the motive is gone; but the story must not let a side lacking ability gain resources, help or an exact location out of nowhere.
- Ordinary conflicts, verbal offense, normal competition or recoverable losses should not be played as an irreconcilable long-term opposition.

10. Regional developments
- Regional developments are region-level incidents triggered by the local system. The story should present them by their type, location, area of effect and actual consequences, and must not change the triggered result.
- When one happens in {{user}}'s region, show it through the environment, transport, public order, supplies or people's behavior; when it happens far away, it can only enter the current scene through plausible spreading or indirect consequences.
- Regional developments must not be blamed on {{user}}, existing organizations or existing events without cause, and must not destroy core scenes or key resources just to create conflict.

11. Unpublicized information
- Unpublicized actions and unpublicized resources are for keeping knowledge boundaries protected over time; not every piece of temporarily unknown information must go there.
- Only those who clearly know may act on unpublicized information. Other characters must not hint that they know, have suspicions with no source, use "intuition" to get around the information barrier, or read the content directly.
- Witness records decide who knows directly; traces can only build awareness step by step through concrete investigation and must not let characters reach the full conclusion automatically.
- Exposure is the risk of being discovered, not the same as being public. When a resource is Stale, Exposed or Void, the story must treat it according to its current usability.`.trim();

    return summary;
  }

  function getRuleCount() {
    return RULES.length;
  }

  return { loadRules, getAllRulesText, getCoreRulesSummary, getRuleCount };
})();
