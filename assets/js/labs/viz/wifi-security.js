/* ==========================================================================
   wifi-security.js — how wireless security actually works, and where it fails.
   --------------------------------------------------------------------------
   Four families over one subject:

     1. The generations  — WEP, WPA/TKIP, WPA2-PSK, WPA2-Enterprise, WPA3-SAE:
                           what each one fixed, what each one still leaks, and
                           roughly when each stopped being adequate.
     2. The handshake    — the WPA2 four-way handshake with the PTK derivation
                           drawn out input by input, then SAE beside it, so the
                           one difference that matters is visible: what a
                           listener is holding when the exchange finishes.
     3. Evil twin        — a look-alike network name and a sign-in page, walked
                           through stage by stage, with the tell at each stage
                           and what changes when the real network has a key.
     4. What helps       — hidden names, MAC filters, and the public-wifi
                           question, answered against what HTTPS already does.

   Decisions worth spelling out:

   1. This file performs no cryptography and makes no network request. The
      hex strings in family 2 are a deterministic placeholder so that changing
      the SSID visibly changes the PMK — which is a real property worth seeing,
      because it is why a precomputed table has to be built per network name.
      They are labelled as illustrative everywhere they appear. Nothing here is
      a real PMK, a real nonce or a real MIC, and the page says so on screen.

   2. This is an explanation, not a workshop. There is no capture step, no
      cracking, nothing about knocking a client off a network, and no tool
      named for any of it. The mechanism and the defence are the whole content,
      and they are enough — the reason WPA2 handshakes are worth protecting is
      much clearer once you can see which five of the six PRF inputs travel in
      the clear.

   3. The public-wifi family is deliberately unflattering to the usual advice.
      HTTPS did most of the work years ago, and a VPN moves trust rather than
      removing it. Saying that plainly is more useful than repeating a warning
      that stopped being true around 2015.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  CORE 1 — THE GENERATIONS                                                */
  /* ------------------------------------------------------------------------ */
  /*  Dates are the years the thing was usable in practice, not the years the  */
  /*  standard was ratified, because those differ by a lot and the practical   */
  /*  one is what a person deploying a network cares about.                    */
  /* ======================================================================== */

  var GENERATIONS = [
    {
      key: 'wep',
      name: 'WEP',
      full: 'Wired Equivalent Privacy',
      years: '1997 to about 2004',
      tone: 'red',
      cipher: 'RC4 stream cipher, 40-bit or 104-bit key plus a 24-bit IV',
      integrity: 'CRC-32, which is a checksum and not a message authentication code',
      auth: 'One shared key for the whole network, typed as hex',
      fixed: 'Nothing before it — it was the first attempt, and it was designed to be ' +
        'cheap enough to run on 1997 hardware rather than to resist an attacker.',
      leaks: [
        'The 24-bit initialisation vector is sent in the clear and is small enough that it ' +
          'repeats within hours on a busy network. Two frames sharing an IV share a keystream.',
        'CRC-32 is linear, so a frame can be altered and its checksum corrected to match ' +
          'without ever knowing the key. Integrity was never actually protected.',
        'The key is recovered from ordinary captured traffic by statistical analysis. There ' +
          'is no passphrase guessing involved, which is why key length never helped.'
      ],
      dead: 'Publicly and completely broken by 2001. The Wi-Fi Alliance deprecated it in 2004 ' +
        'and WPA3-certified equipment will not speak it at all.',
      verdict: 'no',
      verdictText: 'Never. If a device only offers WEP, the device is the problem.'
    },
    {
      key: 'wpa',
      name: 'WPA / TKIP',
      full: 'Wi-Fi Protected Access, Temporal Key Integrity Protocol',
      years: '2003 to about 2012',
      tone: 'red',
      cipher: 'RC4 again, but with a per-packet key mixed from the base key, the sender ' +
        'address and a 48-bit sequence counter',
      integrity: 'Michael, a real MIC — but a deliberately weak one, so weak that the ' +
        'standard bolts on a countermeasure: two MIC failures in a minute and the link shuts down',
      auth: 'A passphrase shared by everyone, or 802.1X',
      fixed: 'Almost everything structural about WEP: per-packet keys so no two frames share a ' +
        'keystream, a replay counter, and integrity that is at least keyed. All of it as a ' +
        'firmware upgrade to hardware that could only do RC4, which was the entire point and ' +
        'also the entire limitation.',
      leaks: [
        'Still RC4, and still carrying WEP-shaped compromises to stay on WEP-era silicon.',
        'Michael is weak enough that partial plaintext recovery and limited frame injection ' +
          'were demonstrated from 2008 onward, without recovering the key.',
        'Sharing an SSID with a WPA2 network in mixed mode drags the whole network down to ' +
          'the weaker option for any client that asks for it.'
      ],
      dead: 'Deprecated. Since 2012 the Wi-Fi Alliance has not certified TKIP-only devices, ' +
        'and WPA3 certification forbids TKIP outright.',
      verdict: 'no',
      verdictText: 'No. It was a transitional fix for hardware that has since been landfill ' +
        'for a decade.'
    },
    {
      key: 'wpa2',
      name: 'WPA2-PSK',
      full: 'WPA2 with a pre-shared key, AES-CCMP',
      years: '2004 to now, with caveats',
      tone: 'amber',
      cipher: 'AES-128 in CCM mode (CCMP) — a real block cipher, with no practical break ' +
        'against the cipher itself after twenty years of attention',
      integrity: 'CBC-MAC over the frame, part of CCM, genuinely authenticated',
      auth: 'One passphrase for the network. It becomes the PMK through PBKDF2 with the ' +
        'SSID as salt and 4096 iterations',
      fixed: 'The cipher and the integrity, properly and for good. Everything wrong with ' +
        'WPA2 today is about the key exchange and the shared secret, not about CCMP.',
      leaks: [
        'The four-way handshake is a verifiable offline target. Everything it puts on the ' +
          'air except the PMK is public, so anyone who sees one exchange can test passphrase ' +
          'guesses at their own pace, on their own hardware, with no further contact with the ' +
          'network and nothing for the network to notice or rate-limit.',
        'One secret for everyone. Anybody who knows the passphrase can derive the keys of ' +
          'every other client on that network, because the PMK is the same for all of them.',
        'No forward secrecy. If the passphrase is learned in 2030, traffic recorded in 2026 ' +
          'becomes readable, because the session key was only ever derived from the passphrase ' +
          'and two public nonces.',
        'Management frames are unprotected unless 802.11w is on, which on WPA2 is optional ' +
          'and often off.'
      ],
      dead: 'Not dead. Still the most common setting on the planet, and with a long random ' +
        'passphrase it is genuinely adequate. It is the floor, not the goal.',
      verdict: 'ok',
      verdictText: 'Acceptable with a long random passphrase. The passphrase is doing all ' +
        'of the work, so it has to be worth something.'
    },
    {
      key: 'ent',
      name: 'WPA2-Enterprise',
      full: 'WPA2 with 802.1X and EAP, against a RADIUS server',
      years: '2004 to now',
      tone: 'green',
      cipher: 'The same AES-CCMP as WPA2-PSK — the cipher is not what changes here',
      integrity: 'The same as WPA2-PSK',
      auth: 'Each user authenticates individually to a RADIUS server through EAP, and each ' +
        'session gets its own PMK. There is no shared passphrase anywhere',
      fixed: 'The shared secret, which is the thing actually wrong with WPA2-PSK. No single ' +
        'passphrase to guess, no client able to derive another client’s keys, and access ' +
        'revoked per person rather than by changing one passphrase and re-typing it on four ' +
        'hundred devices.',
      leaks: [
        'Its safety rests on the client validating the RADIUS server’s certificate. A client ' +
          'configured to accept any certificate will authenticate happily to an impersonated ' +
          'network and hand over its identity and its authentication exchange.',
        'With MSCHAPv2 inside the tunnel, that exchange is a challenge and response that can ' +
          'be attacked offline afterwards. The protocol is fine; the configuration is what fails.',
        'It is materially harder to run. A RADIUS server, a certificate the clients trust, and ' +
          'enforced client configuration are all real work, which is why small networks skip it.'
      ],
      dead: 'Current, and the right answer for any organisation large enough to have a ' +
        'directory. WPA3-Enterprise tightens the cipher suite further.',
      verdict: 'ok',
      verdictText: 'The correct answer for organisations — provided client certificate ' +
        'validation is enforced rather than left to the person joining.'
    },
    {
      key: 'wpa3',
      name: 'WPA3-SAE',
      full: 'WPA3 Personal, Simultaneous Authentication of Equals',
      years: '2018 to now',
      tone: 'green',
      cipher: 'AES-128 CCMP as a minimum, GCMP-256 in the 192-bit enterprise mode',
      integrity: 'As WPA2, plus mandatory Protected Management Frames',
      auth: 'SAE, a password-authenticated key exchange, replaces the PSK handshake and ' +
        'produces a fresh PMK for every session',
      fixed: 'The offline guessing target, which was the last big structural problem. A ' +
        'listener who watches an SAE exchange end to end holds nothing they can test a ' +
        'password guess against, so every guess costs one live exchange with the access ' +
        'point — which the access point can slow down, refuse and log. Forward secrecy comes ' +
        'with it: the session key depends on random values chosen fresh each time, so learning ' +
        'the password later does not decrypt anything recorded earlier. Protected Management ' +
        'Frames become mandatory, which closes the old gap where the frames that manage a ' +
        'connection carried no protection at all.',
      leaks: [
        'It is still one password for the network. Everyone who has it is on the network, and ' +
          'a password that has been shared with forty people is not a secret.',
        'Transition mode, where one SSID offers both WPA3 and WPA2 so older devices can still ' +
          'join, leaves a WPA2 handshake available on that same network — and with it the ' +
          'offline target that WPA3 exists to remove.',
        'The Dragonblood work in 2019 found side-channel and downgrade weaknesses in early ' +
          'implementations. They were fixed in firmware, and they are a standing reminder that ' +
          'a sound protocol implemented carelessly is a careless deployment.'
      ],
      dead: 'Current. Widely supported on anything bought since roughly 2020.',
      verdict: 'good',
      verdictText: 'Yes. Turn transition mode off once nothing on the network still needs it.'
    }
  ];

  /* ======================================================================== */
  /*  CORE 2 — THE HANDSHAKES                                                 */
  /* ------------------------------------------------------------------------ */
  /*  An illustrative fingerprint, not a hash of anything. It exists so that   */
  /*  editing the SSID visibly changes the PMK on screen, which is the real    */
  /*  and slightly surprising property behind "a precomputed table has to be   */
  /*  built per network name". Every place it is printed says what it is.      */
  /* ======================================================================== */

  function fingerprint(text, bytes) {
    var out = '';
    var s = String(text);
    for (var b = 0; b < bytes; b++) {
      var h = 0x811c9dc5 ^ (b * 0x9e3779b1);
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i) + b;
        h = (h * 0x01000193) >>> 0;
      }
      var v = (h >>> 11) & 0xff;
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  var AP_MAC = 'a4:2b:8c:00:1f:7e';
  var STA_MAC = '5e:d0:34:91:c2:06';

  /* The WPA2 four-way handshake, as frames.

     `known` is what a passive listener is holding once this frame has gone by,
     and it is the whole reason the family exists: by message 2 the list is
     complete except for the PMK, and a list that is complete except for one
     guessable item is a cracking target. */
  function wpa2Handshake(ssid, pass) {
    var pmk = fingerprint('pmk|' + pass + '|' + ssid, 8);
    var aNonce = fingerprint('anonce|' + ssid, 8);
    var sNonce = fingerprint('snonce|' + ssid, 8);
    var ptk = fingerprint('ptk|' + pmk + aNonce + sNonce, 12);

    var frames = [
      {
        dir: 'calc',
        actor: 'Both sides, before a single frame is sent',
        title: 'The passphrase becomes the PMK',
        wire: 'Nothing is transmitted. Both ends do this arithmetic on their own.',
        body: 'PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096 iterations, 256 bits). The SSID ' +
          'is the salt, which is why the same passphrase on two differently-named networks ' +
          'produces two different PMKs — and why a precomputed table only helps against the ' +
          'network name it was built for.',
        known: []
      },
      {
        dir: 'ap',
        actor: 'Access point → client',
        title: 'Message 1',
        wire: 'ANonce — 32 random bytes, in the clear',
        body: 'The access point sends a nonce and nothing else. There is no MIC on this frame ' +
          'because no key has been derived yet, which is also why a client cannot tell from ' +
          'message 1 alone whether it is talking to the right access point.',
        known: ['ANonce', 'The access point’s MAC address (it is in every frame header)']
      },
      {
        dir: 'calc',
        actor: 'Client, locally',
        title: 'The client derives the PTK',
        wire: 'Nothing is transmitted.',
        body: 'The client picks its own nonce and now has every input the pseudo-random ' +
          'function needs. PTK = PRF-384(PMK, "Pairwise key expansion", min(AA,SPA) ‖ ' +
          'max(AA,SPA) ‖ min(ANonce,SNonce) ‖ max(ANonce,SNonce)). Sorting the pairs is what ' +
          'lets both ends compute the same value without agreeing who is first.',
        known: []
      },
      {
        dir: 'sta',
        actor: 'Client → access point',
        title: 'Message 2',
        wire: 'SNonce in the clear, plus a MIC over the frame computed with the KCK',
        body: 'This is the frame that matters. The listener now holds both nonces, both MAC ' +
          'addresses, and a MIC that can only have been produced by the correct PTK. Guess a ' +
          'passphrase, derive the PMK, derive the PTK, compute the MIC, compare. A match is a ' +
          'confirmed passphrase. Nothing further needs to be sent to the network, so there is ' +
          'nothing the network can slow down, refuse or notice.',
        known: ['SNonce', 'The client’s MAC address',
          'A MIC that any candidate passphrase can be tested against, offline and unlimited']
      },
      {
        dir: 'ap',
        actor: 'Access point → client',
        title: 'Message 3',
        wire: 'The group key (GTK) encrypted under the KEK, plus a MIC under the KCK',
        body: 'The access point proves it holds the same PTK and hands over the group key used ' +
          'for broadcast and multicast traffic. This is the first frame that tells the client ' +
          'anything about who it is actually talking to.',
        known: ['A second MIC, over a different frame, testable the same way',
          'The encrypted GTK — unreadable without the KEK']
      },
      {
        dir: 'sta',
        actor: 'Client → access point',
        title: 'Message 4',
        wire: 'An acknowledgement, with a MIC',
        body: 'Both ends install the keys. From here everything is encrypted with the TK under ' +
          'CCMP, and the handshake is over. It took four frames and about a hundred milliseconds.',
        known: ['That the handshake completed, so the passphrase guessed against it is testable ' +
          'against a known-good exchange']
      },
      {
        dir: 'end',
        actor: 'What the listener is left holding',
        title: 'The result',
        wire: '',
        body: 'Two nonces, two MAC addresses, and two verifiable MICs. Five of the six inputs ' +
          'to the PRF are public: four of them travelled in the clear across those frames, and ' +
          'the fifth is a fixed string printed in the standard. The sixth is the PMK, and the PMK is only the ' +
          'passphrase and the network name. The security of the whole network reduces to how ' +
          'hard that one passphrase is to guess — which is why a long random passphrase is not ' +
          'general advice here, it is the specific and only defence.',
        known: []
      }
    ];

    return {
      mode: 'wpa2',
      pmk: pmk, aNonce: aNonce, sNonce: sNonce, ptk: ptk,
      frames: frames,
      inputs: [
        { label: 'PMK, 256 bits', secret: true, at: 0,
          detail: 'PBKDF2 of the passphrase, salted with the SSID. The one input a listener ' +
            'does not have.', value: pmk },
        { label: '"Pairwise key expansion"', secret: false, at: 0,
          detail: 'A fixed string written into the standard. Public by definition.', value: null },
        { label: 'AA — access point MAC', secret: false, at: 1,
          detail: 'In the header of every frame the access point sends.', value: AP_MAC },
        { label: 'SPA — client MAC', secret: false, at: 1,
          detail: 'In the header of every frame the client sends.', value: STA_MAC },
        { label: 'ANonce, 32 bytes', secret: false, at: 1,
          detail: 'Sent in the clear in message 1.', value: aNonce },
        { label: 'SNonce, 32 bytes', secret: false, at: 3,
          detail: 'Sent in the clear in message 2.', value: sNonce }
      ],
      outputs: [
        { label: 'KCK, 128 bits', detail: 'Signs every frame of the handshake. This is the key ' +
          'the MIC in message 2 is computed with, and therefore the key a guess is tested against.' },
        { label: 'KEK, 128 bits', detail: 'Encrypts the group key carried in message 3.' },
        { label: 'TK, 128 bits', detail: 'Encrypts your actual traffic under CCMP.' }
      ],
      prf: 'PRF-384',
      verdict: 'bad',
      verdictText: 'A complete offline guessing target. One captured exchange, unlimited ' +
        'guesses, nothing sent to the network.'
    };
  }

  /* SAE, as specified in 802.11 and RFC 7664. The commit exchange is
     simultaneous rather than challenge and response, which is where the name
     comes from — neither peer is the initiator, and neither learns anything
     about the other's password before proving it holds the same one. */
  function saeHandshake(ssid, pass) {
    var pwe = fingerprint('pwe|' + pass + '|' + ssid, 8);
    var scalarA = fingerprint('scA|' + ssid, 8);
    var scalarB = fingerprint('scB|' + ssid, 8);
    var pmk = fingerprint('saepmk|' + pass + '|' + scalarA + scalarB, 8);

    var frames = [
      {
        dir: 'calc',
        actor: 'Both sides, before a single frame is sent',
        title: 'The password becomes a point on a curve',
        wire: 'Nothing is transmitted.',
        body: 'Both ends derive PWE, the password element, from the password and the two MAC ' +
          'addresses. In WPA3 this uses hash-to-element, which reaches the answer in constant ' +
          'time — the older hunting-and-pecking loop took a variable number of tries and that ' +
          'timing difference was itself a leak. PWE is deterministic from the password, but on ' +
          'its own it never leaves either device.',
        known: []
      },
      {
        dir: 'both',
        actor: 'Each side, independently',
        title: 'Two random values, kept',
        wire: 'Nothing is transmitted.',
        body: 'Each end chooses a private value and a mask at random, fresh for this exchange. ' +
          'Neither is ever sent, neither depends on the password, and neither will exist again. ' +
          'This is where forward secrecy comes from.',
        known: []
      },
      {
        dir: 'sta',
        actor: 'Client → access point (and the access point sends its own, at the same time)',
        title: 'Commit',
        wire: 'scalar = (private + mask) mod r, and element = inverse(mask × PWE)',
        body: 'Both ends send a scalar and a curve element. The password is in there, but only ' +
          'blinded by a random mask, and recovering the mask from the element means solving a ' +
          'discrete logarithm. There is no order to this: both commits go out together, which ' +
          'is what "simultaneous authentication of equals" means.',
        known: ['The client’s scalar and element', 'The access point’s scalar and element']
      },
      {
        dir: 'calc',
        actor: 'Both sides, locally',
        title: 'The shared secret',
        wire: 'Nothing is transmitted.',
        body: 'Each end computes K = private × (peer_scalar × PWE + peer_element). Both arrive ' +
          'at the same K only if both started from the same PWE, which means only if both know ' +
          'the same password. From K and the two scalars, both derive a KCK and the PMK.',
        known: []
      },
      {
        dir: 'both',
        actor: 'Both directions',
        title: 'Confirm',
        wire: 'A confirm hash over the transcript, keyed with the KCK',
        body: 'Each side proves it reached the same K. A wrong password produces a different ' +
          'PWE, a different K and a confirm that does not verify — and the access point simply ' +
          'refuses, counts the failure and can slow the next attempt down. One guess, one ' +
          'exchange, on the network’s terms.',
        known: ['Two confirm hashes, each computed with a key derived from the shared secret']
      },
      {
        dir: 'calc',
        actor: 'Both sides',
        title: 'And then the four-way handshake runs anyway',
        wire: 'The same four frames as WPA2.',
        body: 'SAE replaces where the PMK comes from, not the rest of the protocol. The four-way ' +
          'handshake still runs to derive the session keys — but it now runs on a PMK that was ' +
          'produced from fresh random values rather than from the password alone, so its MICs ' +
          'are not a target. Same frames, entirely different meaning.',
        known: ['A four-way handshake whose MICs cannot be tested against a password guess']
      },
      {
        dir: 'end',
        actor: 'What the listener is left holding',
        title: 'The result',
        wire: '',
        body: 'Two scalars, two elements, two confirms. To test one password guess against any ' +
          'of it, you would have to recover a random value that was never sent — the discrete ' +
          'logarithm problem, which is the same thing that keeps ordinary public-key ' +
          'cryptography standing up. So there is no offline test. Each guess has to be tried ' +
          'live against the access point, one at a time, where it can be rate-limited, refused ' +
          'and logged. That is the entire improvement, and it is a large one.',
        known: []
      }
    ];

    return {
      mode: 'wpa3',
      pmk: pmk, pwe: pwe, scalarA: scalarA, scalarB: scalarB,
      frames: frames,
      inputs: [
        { label: 'PWE — the password element', secret: true, at: 0,
          detail: 'Derived from the password and both MAC addresses. Never transmitted.',
          value: pwe },
        { label: 'private — random, per exchange', secret: true, at: 1,
          detail: 'Chosen fresh, never sent, discarded afterwards.', value: null },
        { label: 'mask — random, per exchange', secret: true, at: 1,
          detail: 'Chosen fresh, never sent. Blinds the password element.', value: null },
        { label: 'client scalar and element', secret: false, at: 2,
          detail: 'Sent in the clear — and useless without the random values behind them.',
          value: scalarA },
        { label: 'access point scalar and element', secret: false, at: 2,
          detail: 'Also in the clear, also useless on its own.', value: scalarB },
        { label: 'the two MAC addresses', secret: false, at: 2,
          detail: 'Public, as always.', value: AP_MAC + ' / ' + STA_MAC }
      ],
      outputs: [
        { label: 'K — the shared secret', detail: 'Computed identically by both ends, from ' +
          'values a listener cannot reconstruct.' },
        { label: 'PMK, 256 bits', detail: 'Fresh for this session. Feeds the four-way handshake ' +
          'that follows.' },
        { label: 'KCK', detail: 'Keys the confirm hashes that prove both ends agree.' }
      ],
      prf: 'KDF over K',
      verdict: 'good',
      verdictText: 'No offline target. Each password guess costs one live exchange, which the ' +
        'access point controls.'
    };
  }

  /* ======================================================================== */
  /*  CORE 3 — EVIL TWIN AND CAPTIVE PORTALS                                  */
  /* ------------------------------------------------------------------------ */
  /*  Stages and tells only. There is no technique here, and the portal on the */
  /*  stage is a drawing: no inputs, no form, nothing that accepts a keystroke.*/
  /* ======================================================================== */

  var EVIL_OPEN = [
    {
      title: 'An open network authenticates nothing',
      body: 'A café or airport network with no passphrase has no key, and with no key there ' +
        'is nothing for an access point to prove. The SSID is just a name being broadcast, and ' +
        'any radio can broadcast any name. Your device remembers the name, not the hardware.',
      tell: 'There is no tell yet, and that is the honest starting point — at this stage ' +
        'everything looks exactly as it should, because everything is exactly as it should be.',
      spot: 'you'
    },
    {
      title: 'A second radio broadcasts the same name',
      body: 'Now two access points answer to the same SSID. To your phone this looks like one ' +
        'network with two access points, which is completely normal in any building large ' +
        'enough to need two. It picks whichever is strongest and joins without asking you.',
      tell: 'Two entries with the same name and very different signal strength, or a network ' +
        'you joined yesterday that is suddenly far stronger than it was. Weak evidence on its ' +
        'own — but worth noticing before you type anything.',
      spot: 'twin'
    },
    {
      title: 'The look-alike hands out the addressing',
      body: 'Having joined, your device asks for an IP address, a gateway and a DNS server, and ' +
        'takes whatever answer arrives. Every name lookup now goes to a resolver the operator ' +
        'of that radio controls, so any name can be pointed at any address they like.',
      tell: 'Nothing visible. This is the step people assume they would notice, and it is the ' +
        'step that is completely silent.',
      spot: 'twin'
    },
    {
      title: 'A sign-in page appears',
      body: 'A page opens asking you to accept terms or sign in. This is exactly what a genuine ' +
        'captive portal does — it is a normal, expected part of joining a public network — which ' +
        'is precisely why it is the chosen shape for this.',
      tell: 'Check the address bar rather than the page. A portal that has no certificate for ' +
        'the name it claims, or that sits on a bare IP address, or that triggers a certificate ' +
        'warning, is not the network operator’s page. A certificate warning on a sign-in page ' +
        'is a stop, not an inconvenience.',
      spot: 'portal'
    },
    {
      title: 'It asks for something it should not need',
      body: 'A real portal might want a room number, a surname or a voucher code. What it does ' +
        'not need is your email password, a social account sign-in, a card number for free ' +
        'wireless, or an app installed to continue.',
      tell: 'The ask itself is the tell, and it is the most reliable one on this page. No ' +
        'legitimate wireless network needs your mail password. If the page wants a credential ' +
        'that unlocks something other than the wifi, close it.',
      spot: 'portal'
    },
    {
      title: 'What you typed goes to whoever runs the radio',
      body: 'Credentials entered into that page reach the person operating it. If the password ' +
        'is reused anywhere — and most are — the damage is not to your wireless connection, it ' +
        'is to every account sharing that password.',
      tell: 'If you have already typed something, change that password from a different network ' +
        'and turn on a second factor. That is a much better use of the next ten minutes than ' +
        'working out exactly what happened.',
      spot: 'attacker'
    },
    {
      title: 'What holds up regardless',
      body: 'HTTPS. A network operator cannot read or alter a TLS session without a certificate ' +
        'your browser already trusts, and if they try, the browser says so in language nobody ' +
        'has to interpret. What they can still see is which hosts you connect to, and what they ' +
        'can still do is show you a page that looks like a login for a site you use.',
      tell: 'Never click through a certificate warning on a network you just joined. Do not ' +
        'sign into anything from a page the network handed you — open the site yourself, from ' +
        'your own bookmark, and see whether it actually wants you to log in.',
      spot: 'you'
    }
  ];

  var EVIL_PSK = [
    {
      title: 'The same look-alike name, but the real network has a key',
      body: 'The impostor can broadcast the SSID perfectly. What it cannot do is know the ' +
        'passphrase, and on a WPA2 or WPA3 network the passphrase is the thing the whole ' +
        'association depends on.',
      tell: 'None needed yet. The protocol is about to do the work for you.',
      spot: 'twin'
    },
    {
      title: 'Your device starts the four-way handshake',
      body: 'Your device has the stored passphrase, so it derives the PMK and expects the ' +
        'access point to prove it holds the same one. That proof is message 3, and it is signed ' +
        'with a key that can only come from the correct passphrase.',
      tell: 'This is mutual, which is the part people forget. The handshake is not only the ' +
        'network checking you.',
      spot: 'you'
    },
    {
      title: 'The impostor cannot produce message 3',
      body: 'Without the passphrase there is no PMK, without the PMK there is no PTK, and ' +
        'without the PTK there is no MIC that will verify. The exchange fails and your device ' +
        'does not join.',
      tell: 'A network you have joined a hundred times that suddenly will not connect, or that ' +
        'asks for the passphrase again, is worth a second look rather than a re-type.',
      spot: 'twin'
    },
    {
      title: 'So the attack changes shape instead',
      body: 'The usual next move is not a cleverer attack on the key — it is an open network ' +
        'with the same name, or a name one character different, hoping you will join the one ' +
        'without a lock icon and not notice. The cryptography held; the naming did not.',
      tell: 'Look for the lock. A network you know has a passphrase appearing without one is ' +
        'not the network you know, whatever it is called.',
      spot: 'attacker'
    },
    {
      title: 'Where an enterprise network still gets caught',
      body: 'On WPA2-Enterprise there is no shared passphrase, so the check is against the ' +
        'RADIUS server’s certificate instead. A client configured to accept any certificate ' +
        'will authenticate to an impersonated network and hand over its identity and its ' +
        'authentication exchange. The protocol is sound; the client setting is what fails.',
      tell: 'For an organisation: push the network profile centrally with the CA pinned, and do ' +
        'not let people join by typing the name. For a person: if a work network asks you to ' +
        'accept an unfamiliar certificate, ask before you do.',
      spot: 'attacker'
    },
    {
      title: 'And what actually closes it',
      body: 'A passphrase you do not hand out casually, WPA3 where the equipment supports it, ' +
        'and Protected Management Frames — which WPA3 makes mandatory — so that the frames ' +
        'controlling your connection cannot simply be forged by anything in range. Before ' +
        '802.11w those frames carried no protection at all, which is why moving a client from ' +
        'the real network to a look-alike used to be so much easier than it is now.',
      tell: 'On your own router: WPA3 if everything supports it, WPA2 with a long random ' +
        'passphrase if not, PMF enabled, WPS off.',
      spot: 'you'
    }
  ];

  var EVIL_TELLS = [
    ['Two networks, one name, wildly different signal', 'Could be a second access point in a ' +
      'big building, could be a look-alike', 'Do not type credentials until you are on a ' +
      'network you chose deliberately'],
    ['A familiar network appears without its lock icon', 'A network you know has a passphrase ' +
      'does not lose it', 'Do not join it; the missing lock is the whole signal'],
    ['A sign-in page you did not go looking for', 'Normal for a captive portal, and also the ' +
      'shape of the attack', 'Read the address bar, not the page'],
    ['A certificate warning on that page', 'The page is not who it says it is, for some reason ' +
      'or another', 'Stop. This is the one warning that is almost never a false alarm'],
    ['It wants your email or social password', 'No wireless network has ever needed that',
      'Close it. Nothing legitimate is lost by refusing'],
    ['It wants a card "for verification" on free wifi', 'Free and card details do not belong ' +
      'in the same sentence', 'Close it'],
    ['It asks you to install an app or a profile to continue', 'A configuration profile can ' +
      'change what your device trusts', 'Refuse; use mobile data instead'],
    ['A network you have used for months asks for the passphrase again', 'Sometimes genuine ' +
      'after a router change, sometimes not', 'Confirm with whoever runs it before re-typing it']
  ];

  /* ======================================================================== */
  /*  CORE 4 — WHAT ACTUALLY HELPS                                            */
  /* ======================================================================== */

  var MYTHS = [
    {
      name: 'Hiding the network name',
      claim: 'If the SSID is not broadcast, nobody knows the network is there.',
      truth: 'The beacon stops carrying the name. Every association, and every probe from ' +
        'every client that knows the network, still carries it in the clear. The name is ' +
        'therefore visible to anyone actually listening to the air, and hidden only from the ' +
        'person scrolling a list of networks.',
      cost: 'It is worse than neutral. Devices configured for a hidden network go looking for ' +
        'it by name wherever they are, which broadcasts the name of your home or office ' +
        'network from a train. It also breaks roaming and joining on some clients.',
      score: 'harm'
    },
    {
      name: 'MAC address filtering',
      claim: 'Only devices on the allow list can connect.',
      truth: 'A MAC address is transmitted in the clear in the header of every single frame, ' +
        'by every device, always — including on an encrypted network, because the header is ' +
        'not the part that gets encrypted. It is an identifier, not a secret. And it is a ' +
        'software setting on essentially every device made.',
      cost: 'Zero security, and a maintenance list somebody has to keep. It is an inventory ' +
        'tool with a lock painted on the front. Modern devices randomising their MAC per ' +
        'network make it actively annoying as well.',
      score: 'none'
    },
    {
      name: 'WPS, the push-button and PIN convenience feature',
      claim: 'A short PIN makes joining easy without weakening anything.',
      truth: 'The eight-digit PIN was validated in two halves, and the last digit is a ' +
        'checksum, so the search space collapses from ten million to roughly eleven thousand. ' +
        'Push-button WPS is a different mechanism with a short activation window and is far ' +
        'less bad, but the PIN method is present and enabled on a great deal of equipment.',
      cost: 'A working bypass of whatever passphrase you chose. Turn WPS off; it is one ' +
        'checkbox and you will not miss it.',
      score: 'harm'
    },
    {
      name: 'Turning the transmit power down',
      claim: 'A weaker signal means the network does not reach outside the building.',
      truth: 'It reduces range for your own devices immediately and noticeably. It reduces ' +
        'range for a receiver with a directional antenna hardly at all, because sensitivity and ' +
        'antenna gain are the receiver’s to choose, not yours.',
      cost: 'You pay in dropped connections, and buy very little. Signal does not stop at the ' +
        'wall you imagined.',
      score: 'none'
    },
    {
      name: 'A guest network',
      claim: 'Visitors go on a separate network, so they cannot reach anything of mine.',
      truth: 'True, but only if the guest network is actually isolated — client isolation on, ' +
        'no route to the internal subnet, no access to the router’s admin interface. A second ' +
        'SSID bridged onto the same LAN is a second door into the same room.',
      cost: 'Genuinely worth doing when it is configured properly, and it is the right home for ' +
        'anything with a camera or a cloud account in it.',
      score: 'help'
    },
    {
      name: 'A long random passphrase',
      claim: 'The passphrase is the boring part.',
      truth: 'On WPA2-PSK the passphrase is the only input to the PMK that an attacker has to ' +
        'guess, and the captured handshake gives them an unlimited, unobserved way to guess it. ' +
        'Everything else in the exchange is public. Length and randomness are the entire ' +
        'defence — a dictionary word with digits on the end is not a long passphrase, it is a ' +
        'short one written awkwardly.',
      cost: 'The single highest-value change on this list, and it takes one minute.',
      score: 'help'
    },
    {
      name: 'WPA3, with transition mode off',
      claim: 'Turning WPA3 on is enough.',
      truth: 'Transition mode keeps a WPA2 handshake available on the same SSID so older ' +
        'devices can still join — and that handshake is exactly the offline target WPA3 exists ' +
        'to remove. With it on, the network is as guessable as it was before for anyone who ' +
        'simply asks for WPA2.',
      cost: 'Turn it off once nothing on the network still needs it, and check what breaks ' +
        'before you decide. It is a real trade and worth making deliberately.',
      score: 'help'
    },
    {
      name: 'Router firmware updates',
      claim: 'It works, so leave it.',
      truth: 'The router is the one device on the network that is reachable from outside it and ' +
        'never gets looked at. KRACK in 2017 and the Dragonblood findings in 2019 were both ' +
        'fixed in firmware, and both sat unpatched on an enormous number of devices for years ' +
        'afterwards.',
      cost: 'Turn automatic updates on if the router has them. If it no longer receives any, ' +
        'that is the actual answer about whether to replace it.',
      score: 'help'
    }
  ];

  var PUBLIC_WIFI = [
    {
      name: 'What HTTPS already protects',
      body: 'The contents of the session, its integrity, and the identity of the site you are ' +
        'talking to. A hostile network cannot read a TLS session, cannot change a byte of it ' +
        'without the change being detected, and cannot impersonate the site without a ' +
        'certificate your browser already trusts. Essentially all of the web is HTTPS now, and ' +
        'browsers warn loudly when it is not.',
      weight: 'This is the single biggest reason public wifi is far less dangerous than the ' +
        'advice about it suggests. The scenario most of that advice describes stopped being ' +
        'the common case around 2015.',
      score: 'help'
    },
    {
      name: 'What still leaks anyway',
      body: 'Which hosts you connect to. The DNS query gives it away unless you use encrypted ' +
        'DNS; the SNI field in the TLS handshake gives it away unless Encrypted Client Hello is ' +
        'in play, which is not yet universal; and the destination IP addresses, packet sizes ' +
        'and timing give a great deal away regardless.',
      weight: 'A network operator can build a list of everywhere you went without decrypting a ' +
        'single byte. That is a real privacy loss and it is not what people think they are ' +
        'being warned about.',
      score: 'warn'
    },
    {
      name: 'Where a VPN genuinely helps',
      body: 'It moves the question of who can see your destination metadata from the café’s ' +
        'router to the VPN provider. If the local network is the thing you have a specific ' +
        'reason to distrust — an unfamiliar network, a hotel that injects adverts into plain ' +
        'HTTP, a network whose operator you would rather not hand a browsing history — that is ' +
        'a real improvement. It also defeats DNS manipulation at the local hop, and gives ' +
        'remote workers a route into a corporate network, which is what most corporate VPNs are ' +
        'actually for.',
      weight: 'Real, specific, and worth paying for when one of those reasons applies to you.',
      score: 'help'
    },
    {
      name: 'Where it is oversold',
      body: 'A VPN does not make you anonymous. It does not stop cookies, account logins or ' +
        'browser fingerprinting, which is how you are actually tracked. It does not protect a ' +
        'device that is already compromised, does not stop phishing or malware, and does not ' +
        'add anything to a session that HTTPS has already encrypted. And it does not remove ' +
        'trust — it moves it, to a company whose logging policy you cannot audit and whose ' +
        'advertising says whatever it likes.',
      weight: 'The "hackers on public wifi will steal your bank details" pitch describes a ' +
        'threat that HTTPS closed years ago. Sold hard, mostly because it is easy to picture.',
      score: 'warn'
    },
    {
      name: 'The honest order to do things in',
      body: 'Keep the device and browser updated. Let HTTPS do its job and never click through ' +
        'a certificate warning. Do not sign into anything on a page the network handed you. Use ' +
        'mobile data or your own hotspot for anything that genuinely matters — it is cheaper ' +
        'than a VPN and strictly better. Turn off automatic joining for open networks, and ' +
        'forget the network when you leave. Then, if you have a specific reason to hide your ' +
        'destinations from the local network, add a VPN.',
      weight: 'In that order. The first four are free and cover most of it; the last one is the ' +
        'one that gets advertised.',
      score: 'help'
    }
  ];

  var PUBLIC_TABLE = [
    ['Reading your banking session', 'Yes — this is what it is for', 'Also yes, redundantly',
      'HTTPS. It already handled this'],
    ['Changing a page in flight', 'Yes, where the site uses HTTPS', 'Yes for the local hop',
      'HTTPS, plus HSTS so there is no plain-HTTP first request'],
    ['Seeing which sites you visit', 'No — DNS, SNI and the IP addresses give it away',
      'Yes, from the local network. The provider sees it instead',
      'Encrypted DNS, and a VPN if the local network is who you are hiding from'],
    ['Injecting adverts into plain HTTP', 'Yes, if the site is HTTPS at all', 'Yes',
      'HTTPS everywhere; the injection only works on what is left'],
    ['A fake sign-in page on a portal', 'Partly — the address bar is the tell',
      'No. You typed it in yourself', 'Not typing credentials into a page the network opened'],
    ['Malware already on your device', 'No', 'No', 'Updates, and not installing it'],
    ['Tracking you across sites', 'No', 'No — cookies and logins do not care about your IP',
      'Browser settings and account hygiene, not the network'],
    ['Your ISP building a profile of you', 'No', 'Yes, for that hop',
      'A VPN. This is its strongest genuine use']
  ];

  var CORE = {
    GENERATIONS: GENERATIONS,
    wpa2Handshake: wpa2Handshake,
    saeHandshake: saeHandshake,
    EVIL_OPEN: EVIL_OPEN, EVIL_PSK: EVIL_PSK, EVIL_TELLS: EVIL_TELLS,
    MYTHS: MYTHS, PUBLIC_WIFI: PUBLIC_WIFI, PUBLIC_TABLE: PUBLIC_TABLE,
    fingerprint: fingerprint
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  if (!MV) return;

  var E = MV.el, clear = MV.clear, group = MV.group, field = MV.field;
  var selectBox = MV.selectBox, textBox = MV.textBox;
  var CC = MV.C;

  var EXTRA_CSS = [
    /* --- family 1: the generations --- */
    '.ws-gens{display:flex;flex-direction:column;gap:9px;}',
    '.ws-gen{padding:10px 12px;border:1px solid ' + CC.line + ';border-left-width:3px;' +
      'border-radius:0 10px 10px 0;background:rgba(15,23,42,.5);}',
    '.ws-gen.future{opacity:.3;}',
    '.ws-gen.cur{background:rgba(125,211,252,.07);}',
    '.ws-gen-red{border-left-color:' + CC.red + ';}',
    '.ws-gen-amber{border-left-color:' + CC.amber + ';}',
    '.ws-gen-green{border-left-color:' + CC.green + ';}',
    '.ws-gen-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;}',
    '.ws-gen-name{margin:0;font-size:14px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-gen-years{font-size:11px;color:' + CC.faint + ';}',
    '.ws-gen-full{margin:1px 0 8px;font-size:11px;color:' + CC.faint + ';}',
    '.ws-gen-spec{margin:0 0 8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:5px 14px;}',
    '.ws-gen-spec div{font-size:11.5px;line-height:1.55;color:' + CC.dim + ';}',
    '.ws-gen-spec b{color:' + CC.cyan + ';font-weight:700;}',
    '.ws-h{margin:9px 0 4px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.ws-p{margin:0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '.ws-list{margin:0;padding-left:17px;font-size:12px;line-height:1.7;color:' + CC.dim + ';}',
    '.ws-list li{margin-bottom:4px;}',
    '.ws-verdict{margin-top:9px;padding:7px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;}',
    '.ws-verdict-no{background:rgba(252,165,165,.08);border:1px solid rgba(252,165,165,.35);color:' + CC.red + ';}',
    '.ws-verdict-ok{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.35);color:#e8d5a8;}',
    '.ws-verdict-good{background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);color:' + CC.green + ';}',

    /* --- family 2: the handshakes --- */
    '.ws-ladder{display:flex;flex-direction:column;gap:6px;margin-bottom:11px;}',
    '.ws-msg{display:flex;gap:10px;padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:9px;background:rgba(15,23,42,.5);}',
    '.ws-msg.future{opacity:.26;}',
    '.ws-msg.cur{border-color:' + CC.cyan + ';background:rgba(125,211,252,.08);}',
    '.ws-msg-n{flex:0 0 auto;width:1.7rem;height:1.7rem;border-radius:50%;display:flex;' +
      'align-items:center;justify-content:center;font-size:11px;font-weight:700;' +
      'background:#0d1729;border:1px solid #2a3d5c;color:' + CC.dim + ';}',
    '.ws-msg-ap .ws-msg-n{color:' + CC.amber + ';border-color:rgba(251,191,36,.5);}',
    '.ws-msg-sta .ws-msg-n{color:' + CC.blue + ';border-color:rgba(56,189,248,.5);}',
    '.ws-msg-both .ws-msg-n{color:' + CC.violet + ';border-color:rgba(167,139,250,.5);}',
    '.ws-msg-end .ws-msg-n{color:' + CC.green + ';border-color:rgba(52,211,153,.5);}',
    '.ws-msg-body{min-width:0;}',
    '.ws-msg-actor{margin:0;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.ws-msg-title{margin:1px 0 0;font-size:12.5px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-msg-wire{margin:5px 0 0;padding:4px 8px;border-radius:6px;background:#0d1729;' +
      'border:1px solid #23334d;font-size:11px;line-height:1.6;color:' + CC.cyan + ';word-break:break-word;}',
    '.ws-msg-note{margin:5px 0 0;font-size:11.5px;line-height:1.7;color:' + CC.dim + ';}',

    '.ws-derive{padding:10px 12px;border:1px solid ' + CC.line + ';border-radius:10px;' +
      'background:rgba(2,6,23,.55);margin-bottom:11px;}',
    '.ws-derive-title{margin:0 0 8px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.ws-in{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid rgba(28,43,68,.6);}',
    '.ws-in:last-of-type{border-bottom:0;}',
    '.ws-in.pending{opacity:.32;}',
    '.ws-in-tag{flex:0 0 auto;align-self:flex-start;font-size:9.5px;letter-spacing:.05em;' +
      'text-transform:uppercase;padding:2px 6px;border-radius:5px;font-weight:700;}',
    '.ws-in-tag.pub{background:rgba(252,165,165,.1);border:1px solid rgba(252,165,165,.4);color:' + CC.red + ';}',
    '.ws-in-tag.sec{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.45);color:' + CC.green + ';}',
    '.ws-in-body{min-width:0;}',
    '.ws-in-label{margin:0;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-in-detail{margin:1px 0 0;font-size:11px;line-height:1.6;color:' + CC.dim + ';}',
    '.ws-in-val{margin:2px 0 0;font-size:10.5px;color:' + CC.faint + ';word-break:break-all;}',
    '.ws-arrow{margin:8px 0 6px;font-size:11px;color:' + CC.cyan + ';text-align:center;}',
    '.ws-outs{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:7px;}',
    '.ws-out{padding:6px 9px;border-radius:8px;background:rgba(56,189,248,.07);border:1px solid rgba(56,189,248,.35);}',
    '.ws-out b{display:block;font-size:11.5px;color:' + CC.blue + ';}',
    '.ws-out span{display:block;margin-top:2px;font-size:10.5px;line-height:1.6;color:' + CC.dim + ';}',
    '.ws-illus{margin:8px 0 0;padding:6px 9px;border-radius:7px;background:rgba(251,191,36,.06);' +
      'border:1px solid rgba(251,191,36,.3);font-size:10.5px;line-height:1.6;color:#e8d5a8;}',

    '.ws-holds{padding:10px 12px;border-radius:0 9px 9px 0;border-left:3px solid ' + CC.amber + ';' +
      'background:rgba(251,191,36,.06);}',
    '.ws-holds.safe{border-left-color:' + CC.green + ';background:rgba(52,211,153,.06);}',
    '.ws-holds h4{margin:0 0 6px;font-size:11.5px;color:' + CC.amber + ';}',
    '.ws-holds.safe h4{color:' + CC.green + ';}',
    '.ws-holds ul{margin:0;padding-left:17px;font-size:11.5px;line-height:1.7;color:#cbd5e1;}',
    '.ws-holds p{margin:6px 0 0;font-size:11.5px;line-height:1.7;color:#cbd5e1;}',

    /* --- family 3: evil twin. Everything below is a drawing. --- */
    '.ws-scene{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:8px;margin-bottom:11px;}',
    '.ws-box{padding:9px;border:1px solid #24344f;border-radius:10px;background:#0d1729;text-align:center;}',
    '.ws-box.lit{border-color:' + CC.amber + ';box-shadow:inset 0 0 0 1px rgba(251,191,36,.3);}',
    '.ws-box-name{display:block;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-box-role{display:block;margin-top:3px;font-size:10.5px;line-height:1.5;color:' + CC.faint + ';}',
    '.ws-box-you .ws-box-name{color:' + CC.blue + ';}',
    '.ws-box-real .ws-box-name{color:' + CC.green + ';}',
    '.ws-box-twin .ws-box-name{color:' + CC.red + ';}',
    '.ws-portal{max-width:22rem;margin:0 0 11px;border:1px solid #2a3d5c;border-radius:10px;overflow:hidden;background:#0b1220;}',
    '.ws-portal-bar{display:flex;align-items:center;gap:6px;padding:6px 9px;background:#131f36;border-bottom:1px solid #24344f;}',
    '.ws-portal-dot{width:8px;height:8px;border-radius:50%;background:#2a3d5c;}',
    '.ws-portal-url{flex:1 1 auto;font-size:10px;color:' + CC.faint + ';text-align:left;word-break:break-all;}',
    '.ws-portal-in{padding:12px;}',
    '.ws-portal-title{margin:0 0 3px;font-size:12.5px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-portal-sub{margin:0 0 10px;font-size:10.5px;line-height:1.55;color:' + CC.faint + ';}',
    '.ws-portal-field{height:1.6rem;margin-bottom:7px;border-radius:6px;background:#0d1729;border:1px solid #24344f;}',
    '.ws-portal-btn{height:1.7rem;border-radius:6px;background:rgba(56,189,248,.2);border:1px solid rgba(56,189,248,.45);}',
    '.ws-portal-cap{margin:6px 0 0;font-size:10px;line-height:1.55;color:' + CC.faint + ';}',
    '.ws-stage-body{padding:9px 11px;border:1px solid ' + CC.line + ';border-radius:9px;background:rgba(15,23,42,.5);margin-bottom:9px;}',
    '.ws-stage-title{margin:0 0 5px;font-size:13px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-tell{padding:9px 11px;border-left:3px solid ' + CC.green + ';border-radius:0 9px 9px 0;background:rgba(52,211,153,.06);}',
    '.ws-tell h4{margin:0 0 4px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:' + CC.green + ';}',
    '.ws-steps{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;}',
    '.ws-pip{flex:1 1 1.4rem;height:4px;border-radius:2px;background:#1b2942;}',
    '.ws-pip.done{background:rgba(125,211,252,.45);}',
    '.ws-pip.cur{background:' + CC.cyan + ';}',

    /* --- family 4: what actually helps --- */
    '.ws-cards{display:flex;flex-direction:column;gap:9px;}',
    '.ws-card{padding:10px 12px;border:1px solid ' + CC.line + ';border-left-width:3px;' +
      'border-radius:0 10px 10px 0;background:rgba(15,23,42,.5);}',
    '.ws-card.future{opacity:.28;}',
    '.ws-card.cur{background:rgba(125,211,252,.07);}',
    '.ws-card-harm{border-left-color:' + CC.red + ';}',
    '.ws-card-none{border-left-color:' + CC.faint + ';}',
    '.ws-card-help{border-left-color:' + CC.green + ';}',
    '.ws-card-warn{border-left-color:' + CC.amber + ';}',
    '.ws-card-name{margin:0 0 5px;font-size:13px;font-weight:700;color:' + CC.ink + ';}',
    '.ws-claim{margin:0 0 7px;padding:5px 9px;border-radius:7px;background:#0d1729;' +
      'border:1px solid #23334d;font-size:11.5px;line-height:1.65;color:' + CC.faint + ';font-style:italic;}',
    '.ws-badge{display:inline-block;margin-left:7px;padding:1px 8px;border-radius:999px;' +
      'font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;vertical-align:middle;}',
    '.ws-badge-harm{background:rgba(252,165,165,.1);border:1px solid rgba(252,165,165,.4);color:' + CC.red + ';}',
    '.ws-badge-none{background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.35);color:' + CC.faint + ';}',
    '.ws-badge-help{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:' + CC.green + ';}',
    '.ws-badge-warn{background:rgba(251,191,36,.09);border:1px solid rgba(251,191,36,.4);color:' + CC.amber + ';}',

    /* Every comparison table in this lab holds sentences rather than figures.
       The shell's white-space:nowrap is right for a column of numbers and wrong
       for a clause, and on a phone it pushed the table out to about 1200px
       inside a 325px scroller — technically scrollable, practically unreadable.
       Scoped to this lab's root id so no other lab on the shell inherits it. */
    '@media (max-width:900px){' +
      '#wifisecviz .oa-td{white-space:normal;min-width:7rem;}' +
      '#wifisecviz .oa-table th{white-space:normal;}}'
  ].join('');

  function para(cls, text) { return E('p', cls, text); }

  function bulletList(items) {
    var ul = E('ul', 'ws-list');
    items.forEach(function (t) { ul.appendChild(E('li', null, t)); });
    return ul;
  }

  /* A row of pips above every stepped stage. The transport already reports
     "step 4 of 7" in words, but a shape you can see at a glance is what tells
     someone there is more to come — the counter reads as chrome and gets
     ignored. */
  function pips(total, cur) {
    var wrap = E('div', 'ws-steps');
    wrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < total; i++) {
      wrap.appendChild(E('span', 'ws-pip' + (i === cur ? ' cur' : (i < cur ? ' done' : ''))));
    }
    return wrap;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — THE GENERATIONS                                              */
  /* ======================================================================== */

  function GenerationsFamily() {
    this.key = 'generations';
    this.label = 'The generations';
    this.algoKey = 'timeline';
  }
  GenerationsFamily.prototype.algoOptions = function () {
    return [{ key: 'timeline', label: 'Oldest first' }];
  };
  GenerationsFamily.prototype.buildPanel = function (host) {
    var g = group('Reading this');
    g.appendChild(E('p', 'oa-hint',
      'Step forward one generation at a time. Each panel says what that generation fixed, what ' +
      'it still leaks, and roughly when it stopped being adequate — which is usually years ' +
      'before anybody stopped deploying it.'));
    g.appendChild(E('p', 'oa-hint',
      'The dates are when each was usable in practice, not when the standard was ratified. ' +
      'Those differ by a lot, and the practical one is what matters if you are choosing a ' +
      'setting on a router.'));
    host.appendChild(g);
  };
  GenerationsFamily.prototype.buildStage = function (host) {
    this.pipHost = E('div');
    this.listHost = E('div', 'ws-gens');
    host.appendChild(this.pipHost);
    host.appendChild(this.listHost);
  };
  GenerationsFamily.prototype.compute = function () {
    this.error = null;
    return GENERATIONS.length;
  };
  GenerationsFamily.prototype.render = function (idx) {
    var cur = Math.min(idx, GENERATIONS.length - 1);

    clear(this.pipHost);
    this.pipHost.appendChild(pips(GENERATIONS.length, cur));

    clear(this.listHost);
    var host = this.listHost;
    GENERATIONS.forEach(function (gen, i) {
      var card = E('div', 'ws-gen ws-gen-' + gen.tone +
        (i > cur ? ' future' : (i === cur ? ' cur' : '')));

      var head = E('div', 'ws-gen-head');
      head.appendChild(E('h3', 'ws-gen-name', gen.name));
      head.appendChild(E('span', 'ws-gen-years', gen.years));
      card.appendChild(head);
      card.appendChild(para('ws-gen-full', gen.full));

      var spec = E('div', 'ws-gen-spec');
      [['Cipher', gen.cipher], ['Integrity', gen.integrity], ['How you get on', gen.auth]]
        .forEach(function (pair) {
          var d = E('div');
          d.appendChild(E('b', null, pair[0] + ': '));
          d.appendChild(document.createTextNode(pair[1]));
          spec.appendChild(d);
        });
      card.appendChild(spec);

      card.appendChild(E('p', 'ws-h', 'What it fixed'));
      card.appendChild(para('ws-p', gen.fixed));
      card.appendChild(E('p', 'ws-h', 'What it still leaks'));
      card.appendChild(bulletList(gen.leaks));
      card.appendChild(E('p', 'ws-h', 'When it stopped being adequate'));
      card.appendChild(para('ws-p', gen.dead));

      card.appendChild(E('p', 'ws-verdict ws-verdict-' + gen.verdict, gen.verdictText));
      host.appendChild(card);
    });
  };
  GenerationsFamily.prototype.note = function (idx) {
    var gen = GENERATIONS[Math.min(idx, GENERATIONS.length - 1)];
    return gen.name + ' — ' + gen.verdictText;
  };
  GenerationsFamily.prototype.compare = function () {
    return {
      title: 'The five, on the one question that separates them',
      head: ['Generation', 'Cipher', 'Shared secret?', 'Offline guessing from a captured exchange',
        'Use it today'],
      rows: [
        { key: 'wep', cells: ['WEP', 'RC4 + CRC-32', 'One key for everyone',
          'Not needed — the key falls out of ordinary traffic', 'No'] },
        { key: 'wpa', cells: ['WPA / TKIP', 'RC4 + Michael', 'One passphrase',
          'Yes, plus weaknesses in the cipher itself', 'No'] },
        { key: 'wpa2', cells: ['WPA2-PSK', 'AES-CCMP', 'One passphrase',
          'Yes — one exchange, unlimited guesses, nothing sent to the network',
          'Only with a long random passphrase'] },
        { key: 'ent', cells: ['WPA2-Enterprise', 'AES-CCMP', 'None — per user',
          'No passphrase to guess, but a client that skips certificate checks can be fooled',
          'Yes, if client config is enforced'] },
        { key: 'wpa3', cells: ['WPA3-SAE', 'AES-CCMP / GCMP', 'One password',
          'No — each guess costs one live exchange the access point can refuse',
          'Yes, with transition mode off'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — THE HANDSHAKE                                                */
  /* ======================================================================== */

  function HandshakeFamily() {
    this.key = 'handshake';
    this.label = 'The handshake';
    this.algoKey = 'wpa2';
    this.ssid = 'CafeGuest';
    /* Pre-filled with an obviously fake string, and the panel says not to
       replace it with a real one. There is no reason to type a passphrase you
       actually use into any web page, including this one, and a field that
       invites it teaches the wrong habit even when nothing is transmitted. */
    this.pass = 'example-passphrase';
  }
  HandshakeFamily.prototype.algoOptions = function () {
    return [
      { key: 'wpa2', label: 'WPA2 — the four-way handshake' },
      { key: 'wpa3', label: 'WPA3 — SAE, the dragonfly exchange' }
    ];
  };
  HandshakeFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The network');
    g.appendChild(field('Network name', textBox(this.ssid, function (v) {
      self.ssid = v; onChange();
    }, 'CafeGuest')));
    g.appendChild(field('Passphrase', textBox(this.pass, function (v) {
      self.pass = v; onChange();
    }, 'example-passphrase')));
    g.appendChild(E('p', 'oa-hint',
      'Do not type a passphrase you actually use. Nothing here is transmitted and nothing is ' +
      'stored, but there is no reason to put a real one into a web page, and this one does not ' +
      'need it.'));
    g.appendChild(E('p', 'oa-hint',
      'Change the network name and watch the PMK change with it. That is real: the SSID is the ' +
      'salt, which is why a precomputed table only helps against the one network name it was ' +
      'built for.'));
    host.appendChild(g);

    var g2 = group('What to look for');
    g2.appendChild(E('p', 'oa-hint',
      'In the WPA2 exchange, count the inputs marked public against the one marked secret. ' +
      'That ratio is the whole vulnerability, and it is why the passphrase carries the entire ' +
      'network.'));
    g2.appendChild(E('p', 'oa-hint',
      'Then switch to SAE and watch the same panel. The values on the air stay public — they ' +
      'are just no longer enough to test a guess against.'));
    host.appendChild(g2);
  };
  HandshakeFamily.prototype.buildStage = function (host) {
    this.pipHost = E('div');
    this.ladderHost = E('div', 'ws-ladder');
    this.deriveHost = E('div');
    this.holdsHost = E('div');
    host.appendChild(this.pipHost);
    host.appendChild(this.ladderHost);
    host.appendChild(this.deriveHost);
    host.appendChild(this.holdsHost);
  };
  HandshakeFamily.prototype.compute = function () {
    this.error = null;
    var ssid = this.ssid || '(unnamed)';
    var pass = this.pass || '(empty)';
    this.model = this.algoKey === 'wpa3' ? saeHandshake(ssid, pass) : wpa2Handshake(ssid, pass);
    return this.model.frames.length;
  };
  HandshakeFamily.prototype.render = function (idx) {
    var model = this.model;
    var cur = Math.min(idx, model.frames.length - 1);

    clear(this.pipHost);
    this.pipHost.appendChild(pips(model.frames.length, cur));

    clear(this.ladderHost);
    var ladder = this.ladderHost;
    model.frames.forEach(function (f, i) {
      var row = E('div', 'ws-msg ws-msg-' + f.dir +
        (i > cur ? ' future' : (i === cur ? ' cur' : '')));
      row.appendChild(E('span', 'ws-msg-n', String(i + 1)));
      var body = E('div', 'ws-msg-body');
      body.appendChild(para('ws-msg-actor', f.actor));
      body.appendChild(para('ws-msg-title', f.title));
      if (f.wire) body.appendChild(para('ws-msg-wire', f.wire));
      body.appendChild(para('ws-msg-note', f.body));
      row.appendChild(body);
      ladder.appendChild(row);
    });

    clear(this.deriveHost);
    var box = E('div', 'ws-derive');
    box.appendChild(E('p', 'ws-derive-title',
      model.mode === 'wpa2' ? 'Deriving the PTK — every input, and who can see it'
                            : 'Deriving the session key — every input, and who can see it'));
    model.inputs.forEach(function (input) {
      var row = E('div', 'ws-in' + (input.at > cur ? ' pending' : ''));
      row.appendChild(E('span', 'ws-in-tag ' + (input.secret ? 'sec' : 'pub'),
        input.secret ? 'secret' : 'on the air'));
      var b = E('div', 'ws-in-body');
      b.appendChild(para('ws-in-label', input.label));
      b.appendChild(para('ws-in-detail', input.detail));
      if (input.value) b.appendChild(para('ws-in-val', input.value + '…'));
      row.appendChild(b);
      box.appendChild(row);
    });
    box.appendChild(E('p', 'ws-arrow', '↓  ' + model.prf + '  ↓'));
    var outs = E('div', 'ws-outs');
    model.outputs.forEach(function (o) {
      var card = E('div', 'ws-out');
      card.appendChild(E('b', null, o.label));
      card.appendChild(E('span', null, o.detail));
      outs.appendChild(card);
    });
    box.appendChild(outs);
    box.appendChild(E('p', 'ws-illus',
      'The hex above is an illustrative fingerprint, not a key. This page performs no ' +
      'cryptography and computes no real PMK, nonce or MIC — the values exist only so that ' +
      'changing the network name visibly changes what depends on it. The structure, the sizes ' +
      'and the roles are the real ones.'));
    this.deriveHost.appendChild(box);

    clear(this.holdsHost);
    var holds = E('div', 'ws-holds' + (model.mode === 'wpa3' ? ' safe' : ''));
    holds.appendChild(E('h4', null, 'What a passive listener is holding, at this step'));
    var items = [];
    model.frames.forEach(function (f, i) {
      if (i <= cur) items = items.concat(f.known);
    });
    if (items.length) holds.appendChild(bulletList(items));
    else holds.appendChild(para('ws-p', 'Nothing yet. No frame has been sent.'));
    if (cur >= model.frames.length - 1) holds.appendChild(para(null, model.verdictText));
    this.holdsHost.appendChild(holds);
  };
  HandshakeFamily.prototype.note = function (idx) {
    var model = this.model;
    var f = model.frames[Math.min(idx, model.frames.length - 1)];
    return f.title + ' — ' + f.body;
  };
  HandshakeFamily.prototype.compare = function () {
    return {
      title: 'The same question asked of three ways onto a network',
      head: ['', 'WPA2-PSK', 'WPA2-Enterprise', 'WPA3-SAE'],
      rows: [
        { key: 'offline', cells: ['Can one captured exchange be guessed against offline?',
          'Yes, without limit', 'No passphrase to guess', 'No'] },
        { key: 'cost', cells: ['What one password guess costs an attacker',
          'A fraction of a second on their own hardware', 'Not applicable',
          'One live exchange the access point can refuse'] },
        { key: 'fs', cells: ['Forward secrecy', 'None — old recordings become readable',
          'Per session', 'Yes, from fresh random values'] },
        { key: 'sep', cells: ['Can one client derive another’s keys?',
          'Yes, if it knows the passphrase', 'No', 'No'] },
        { key: 'pmf', cells: ['Protected management frames', 'Optional, often off',
          'Optional', 'Mandatory'] },
        { key: 'weak', cells: ['Where it actually fails', 'A guessable passphrase',
          'A client that does not check the server certificate',
          'Transition mode, and a password everyone knows'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — EVIL TWIN AND CAPTIVE PORTALS                                */
  /* ------------------------------------------------------------------------ */
  /*  The portal below is a picture built from empty divs. There is no form,   */
  /*  no input element and nothing that accepts a keystroke anywhere in it,    */
  /*  and it is marked aria-hidden with a visible caption saying as much —     */
  /*  a realistic-looking login box is not a thing to leave lying around on a  */
  /*  page, even as a demonstration of one.                                    */
  /* ======================================================================== */

  function EvilTwinFamily() {
    this.key = 'eviltwin';
    this.label = 'Evil twin & portals';
    this.algoKey = 'open';
  }
  EvilTwinFamily.prototype.algoOptions = function () {
    return [
      { key: 'open', label: 'An open network with a sign-in page' },
      { key: 'psk', label: 'A network that has a passphrase' }
    ];
  };
  EvilTwinFamily.prototype.buildPanel = function (host) {
    var g = group('What this is');
    g.appendChild(E('p', 'oa-hint',
      'A stage-by-stage walk through how a look-alike network name and a sign-in page collect ' +
      'credentials, and what a person can actually notice at each stage. It is an explanation ' +
      'of the mechanism and the defence. There is no method here and nothing on this page ' +
      'accepts input.'));
    host.appendChild(g);
    var g2 = group('Try both');
    g2.appendChild(E('p', 'oa-hint',
      'Switch between the two modes. The interesting result is that a network with a ' +
      'passphrase defends itself — the impostor cannot complete the handshake — so the attack ' +
      'moves to open networks and to naming instead. That is worth knowing before you join ' +
      'anything without a lock icon.'));
    host.appendChild(g2);
  };
  EvilTwinFamily.prototype.buildStage = function (host) {
    this.pipHost = E('div');
    this.sceneHost = E('div');
    this.portalHost = E('div');
    this.bodyHost = E('div');
    this.tellHost = E('div');
    host.appendChild(this.pipHost);
    host.appendChild(this.sceneHost);
    host.appendChild(this.portalHost);
    host.appendChild(this.bodyHost);
    host.appendChild(this.tellHost);
  };
  EvilTwinFamily.prototype.compute = function () {
    this.error = null;
    this.stages = this.algoKey === 'psk' ? EVIL_PSK : EVIL_OPEN;
    return this.stages.length;
  };
  EvilTwinFamily.prototype.render = function (idx) {
    var stages = this.stages;
    var cur = Math.min(idx, stages.length - 1);
    var stage = stages[cur];

    clear(this.pipHost);
    this.pipHost.appendChild(pips(stages.length, cur));

    clear(this.sceneHost);
    var scene = E('div', 'ws-scene');
    var nodes = [
      { key: 'you', cls: 'ws-box-you', name: 'Your device',
        role: 'Remembers the network by name, not by hardware' },
      { key: 'real', cls: 'ws-box-real', name: '“CafeGuest”',
        role: 'The genuine access point' },
      { key: 'twin', cls: 'ws-box-twin', name: '“CafeGuest”',
        role: 'A second radio answering to the same name' },
      { key: 'attacker', cls: 'ws-box-twin', name: 'Whoever runs it',
        role: 'Sees whatever the look-alike is given' }
    ];
    nodes.forEach(function (n) {
      var box = E('div', 'ws-box ' + n.cls +
        (n.key === stage.spot || (stage.spot === 'portal' && n.key === 'twin') ? ' lit' : ''));
      box.appendChild(E('span', 'ws-box-name', n.name));
      box.appendChild(E('span', 'ws-box-role', n.role));
      scene.appendChild(box);
    });
    this.sceneHost.appendChild(scene);

    clear(this.portalHost);
    if (stage.spot === 'portal') {
      var portal = E('div', 'ws-portal');
      portal.setAttribute('aria-hidden', 'true');
      var bar = E('div', 'ws-portal-bar');
      bar.appendChild(E('span', 'ws-portal-dot'));
      bar.appendChild(E('span', 'ws-portal-url', 'http://192.0.2.1/login — no padlock, bare address'));
      portal.appendChild(bar);
      var inner = E('div', 'ws-portal-in');
      inner.appendChild(E('p', 'ws-portal-title', 'Sign in to continue'));
      inner.appendChild(E('p', 'ws-portal-sub',
        'Connect with your email account to use this free network'));
      inner.appendChild(E('div', 'ws-portal-field'));
      inner.appendChild(E('div', 'ws-portal-field'));
      inner.appendChild(E('div', 'ws-portal-btn'));
      portal.appendChild(inner);
      this.portalHost.appendChild(portal);
      this.portalHost.appendChild(E('p', 'ws-portal-cap',
        'A drawing of a portal, not a portal. There is no form here and nothing on this page ' +
        'accepts a keystroke. The bare IP address in the bar and the request for an email ' +
        'account are the two things worth looking at.'));
    }

    clear(this.bodyHost);
    var body = E('div', 'ws-stage-body');
    body.appendChild(E('h3', 'ws-stage-title', stage.title));
    body.appendChild(para('ws-p', stage.body));
    this.bodyHost.appendChild(body);

    clear(this.tellHost);
    var tell = E('div', 'ws-tell');
    tell.appendChild(E('h4', null, 'What you can actually notice'));
    tell.appendChild(para('ws-p', stage.tell));
    this.tellHost.appendChild(tell);
  };
  EvilTwinFamily.prototype.note = function (idx) {
    var stage = this.stages[Math.min(idx, this.stages.length - 1)];
    return stage.title + ' — ' + stage.tell;
  };
  EvilTwinFamily.prototype.compare = function () {
    return {
      title: 'The tells, and what to do about each one',
      head: ['What you see', 'What it might mean', 'What to do'],
      rows: EVIL_TELLS.map(function (t, i) {
        return { key: 'tell' + i, cells: [t[0], t[1], t[2]] };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — WHAT ACTUALLY HELPS                                          */
  /* ======================================================================== */

  function RealityFamily() {
    this.key = 'reality';
    this.label = 'What actually helps';
    this.algoKey = 'myths';
  }
  RealityFamily.prototype.algoOptions = function () {
    return [
      { key: 'myths', label: 'Router settings sold as security' },
      { key: 'public', label: 'Public wifi: HTTPS, and where a VPN helps' }
    ];
  };
  RealityFamily.prototype.buildPanel = function (host) {
    var g = group('About this one');
    g.appendChild(E('p', 'oa-hint',
      'Half of the advice people are given about wireless security is about settings that ' +
      'change nothing, and the other half is about a threat that HTTPS largely closed a decade ' +
      'ago. This panel says which is which, including where that means the honest answer is ' +
      '“you probably do not need to buy anything”.'));
    host.appendChild(g);
    var g2 = group('Why the VPN section is blunt');
    g2.appendChild(E('p', 'oa-hint',
      'A VPN is genuinely useful for specific things, and it is sold for a great many others. ' +
      'Separating the two is more use than either repeating the marketing or dismissing the ' +
      'tool, so both halves are stated here.'));
    host.appendChild(g2);
  };
  RealityFamily.prototype.buildStage = function (host) {
    this.pipHost = E('div');
    this.listHost = E('div', 'ws-cards');
    host.appendChild(this.pipHost);
    host.appendChild(this.listHost);
  };
  RealityFamily.prototype.compute = function () {
    this.error = null;
    this.rows = this.algoKey === 'public' ? PUBLIC_WIFI : MYTHS;
    return this.rows.length;
  };
  RealityFamily.prototype.render = function (idx) {
    var rows = this.rows;
    var cur = Math.min(idx, rows.length - 1);
    var isMyth = this.algoKey !== 'public';

    clear(this.pipHost);
    this.pipHost.appendChild(pips(rows.length, cur));

    clear(this.listHost);
    var host = this.listHost;
    var BADGE = { harm: 'makes it worse', none: 'does nothing', help: 'genuinely helps',
                  warn: 'read carefully' };
    rows.forEach(function (r, i) {
      var card = E('div', 'ws-card ws-card-' + r.score +
        (i > cur ? ' future' : (i === cur ? ' cur' : '')));
      var name = E('h3', 'ws-card-name');
      name.appendChild(document.createTextNode(r.name));
      name.appendChild(E('span', 'ws-badge ws-badge-' + r.score, BADGE[r.score] || r.score));
      card.appendChild(name);

      if (isMyth) {
        card.appendChild(para('ws-claim', '“' + r.claim + '”'));
        card.appendChild(E('p', 'ws-h', 'What is actually true'));
        card.appendChild(para('ws-p', r.truth));
        card.appendChild(E('p', 'ws-h', 'What it costs you'));
        card.appendChild(para('ws-p', r.cost));
      } else {
        card.appendChild(para('ws-p', r.body));
        card.appendChild(E('p', 'ws-h', 'How much this matters'));
        card.appendChild(para('ws-p', r.weight));
      }
      host.appendChild(card);
    });
  };
  RealityFamily.prototype.note = function (idx) {
    var r = this.rows[Math.min(idx, this.rows.length - 1)];
    return r.name + ' — ' + (this.algoKey === 'public' ? r.weight : r.cost);
  };
  RealityFamily.prototype.compare = function () {
    return {
      title: 'On a public network: what HTTPS stops, what a VPN stops, what actually does',
      head: ['The worry', 'Does HTTPS stop it?', 'Does a VPN stop it?', 'What actually does'],
      rows: PUBLIC_TABLE.map(function (r, i) {
        return { key: 'pt' + i, cells: [r[0], r[1], r[2], r[3]] };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'wifisecviz',
    mountId: 'viz-wifi-mount',
    name: 'The wireless security explainer',
    css: EXTRA_CSS,
    families: function () {
      return [new GenerationsFamily(), new HandshakeFamily(),
              new EvilTwinFamily(), new RealityFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);
