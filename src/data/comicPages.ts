export interface ComicPanel {
  id: string;
  sceneKey:
    | 'p1_folding_boat'
    | 'p1_palong_wave'
    | 'p1_drum_fall'
    | 'p2_drowned_awang'
    | 'p2_hundred_keli'
    | 'p2_red_glint'
    | 'p3_palong_bite'
    | 'p3_hiding_stone'
    | 'p3_memory_hand'
    | 'p4_echo_cave'
    | 'p4_toxic_clash'
    | 'p4_arms_grow'
    | 'p5_boat_roots'
    | 'p5_ten_seconds'
    | 'p5_storm_hunt'
    | 'p6_legs_shore'
    | 'p6_hunter_sonar'
    | 'p6_palong_grapple'
    | 'p7_maelstrom'
    | 'p7_keli_king'
    | 'p7_claw_boat'
    | 'p8_rain_boats'
    | 'p8_empty_house'
    | 'p8_kampung_road';
  malayText: string;
  englishText: string;
  dialogue?: {
    speaker: string;
    malay: string;
    english: string;
  };
}

export interface ComicPage {
  pageNumber: number;
  headerLeft: string;
  headerRight: string;
  title: string;
  englishTitle: string;
  panels: ComicPanel[];
}

export const COMIC_PAGES: ComicPage[] = [
  {
    pageNumber: 1,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: '01 / 08',
    title: 'Sebelum Tasik',
    englishTitle: 'Before the Lake',
    panels: [
      {
        id: '1-1',
        sceneKey: 'p1_folding_boat',
        malayText:
          'Sebelum namanya tenggelam bersama tubuhnya, Awang ialah seorang ayah yang tahu betapa mudahnya air menyusup ke celah lipatan kertas. Di ambang rumah papan mereka, dia mengajar Aisyah melipat muncung perahu merah itu dua kali. Anak itu menekankan penselnya kuat-kuat ketika menulis nama sendiri, seolah-olah perahu sekecil itu pun memerlukan alamat untuk pulang.',
        englishText:
          'Before his name sank along with his body, Awang was a father who knew how easily water slips between folds of paper. On the threshold of their timber house, he taught Aisyah to fold the prow of the red boat twice. The child pressed her pencil hard as she wrote her own name, as though even a boat that small needed an address to return home.',
        dialogue: {
          speaker: 'AISYAH',
          malay: 'Ayah balik nanti, kita lepas sama-sama, na?',
          english: 'When Dad comes back later, we launch it together, okay?',
        },
      },
      {
        id: '1-2',
        sceneKey: 'p1_palong_wave',
        malayText:
          'Setiap petang, wisel syif di lombong bijih timah Lubuk Hitam melantun dari dinding bukit batu kapur hingga ke rumah mereka. Aisyah tahu berapa lama jarak antara bunyi wisel dan bunyi tapak kasut ayahnya di tangga. Hari itu, dari pangkal jambatan palong, Awang sempat mengangkat tangan. Anak itu membalas lambaiannya sambil mendakap perahu yang belum sempat mereka lepaskan.',
        englishText:
          'Every evening, the shift whistle at the Lubuk Hitam tin mine bounced off the limestone cliffs to their home. Aisyah knew the exact interval between the whistle and the sound of her father’s boots on the steps. That day, from the foot of the palong bridge, Awang raised a hand in farewell. The child waved back, clutching the boat they had not yet launched.',
        dialogue: {
          speaker: 'AWANG',
          malay: 'Tunggu ayah balik.',
          english: 'Wait for Dad to come home.',
        },
      },
      {
        id: '1-3',
        sceneKey: 'p1_drum_fall',
        malayText:
          'Malam itu sebatang papan jambatan patah di bawah kakinya. Awang sempat berpaut pada serpihannya sebelum arus menariknya ke dasar, ke tempat sebuah tong sisa eksperimen yang pecah merembeskan bahan radioaktif ke dalam air. Tepat pada waktunya, wisel syif berbunyi. Jauh di rumah, Aisyah mula mengira berapa lama lagi ayahnya akan sampai.',
        englishText:
          'That night a bridge plank snapped beneath his boots. Awang caught a splinter before the current dragged him to the basin floor, where a ruptured experimental waste drum leaked radioactive material into the water. Right on schedule, the shift whistle blew. Far away at home, Aisyah began counting how much longer until her father arrived.',
      },
    ],
  },
  {
    pageNumber: 2,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: '02 / 08',
    title: 'Seratus Mulut',
    englishTitle: 'A Hundred Mouths',
    panels: [
      {
        id: '2-1',
        sceneKey: 'p2_drowned_awang',
        malayText:
          'Tubuh Awang rebah perlahan-lahan ke atas kelodak. Seratus ekor keli keluar dari celah batu untuk memakan jasadnya. Di dalam tubuh yang sudah lama terdedah kepada sisa lombong itu, ada sel yang telah berubah dan masih bertahan. Apabila jantungnya berhenti, sel-sel itu meneruskan hidup di dalam perut ikan yang memakannya.',
        englishText:
          'Awang’s body settled slowly onto the silt. A hundred catfish emerged from crevices in the stone to feed upon his remains. Inside a body long exposed to mining waste, altered cells still endured. When his heart stopped, those cells lived on inside the bellies of the fish that ate him.',
      },
      {
        id: '2-2',
        sceneKey: 'p2_hundred_keli',
        malayText:
          'Menjelang subuh, kawanan itu sudah berpecah ke seluruh tasik. Ada yang menyusup ke terowong lombong, ada yang membenamkan diri ke dalam lumpur. Setiap ekor membawa secebis daripada tubuh yang sama. Meskipun dipisahkan oleh batu kapur dan air yang dalam, cebisan-cebisan itu masih dapat merasai satu sama lain. Semakin jauh ikan-ikan itu berenang, semakin kuat tarikan untuk berpatah balik.',
        englishText:
          'By dawn, the shoal had scattered across the basin. Some slipped into mine tunnels, others buried themselves in mud. Each carried a fragment of the same body. Though parted by limestone and deep water, the fragments could still sense one another. The farther the fish swam, the stronger the pull to turn back.',
      },
      {
        id: '2-3',
        sceneKey: 'p2_red_glint',
        malayText:
          'Seekor keli terhenti di bawah permukaan. Dalam pandangannya yang hitam berkilat, ada kilasan merah yang menyerupai perahu, walaupun benda itu belum pernah dilihatnya. Jauh di sebalik batu, seekor lagi bergerak resah membawa ingatan tentang tangan yang pernah melipat perahu itu. Kedua-duanya mula berenang mengikut desakan yang belum mereka kenal sebagai lapar.',
        englishText:
          'One catfish paused beneath the surface. Across its glossy black eyes flashed a glint of red resembling a paper boat, though it had never seen such a thing. Far behind the rocks, another stirred restlessly with the memory of hands that had folded that boat. Both began swimming toward an urge they did not yet recognize as hunger.',
      },
    ],
  },
  {
    pageNumber: 3,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'TAHAP 01 → 10 · 03 / 08',
    title: 'Yang Dibawa oleh Bangkai',
    englishTitle: 'What the Carcass Carried',
    panels: [
      {
        id: '3-1',
        sceneKey: 'p3_palong_bite',
        malayText:
          'Di pintu palong yang tenggelam, dua ekor keli berebut laluan sempit dan saling membenamkan gigi. Bisa daripada serangan sebelumnya masih mengalir di dalam luka. Lama selepas kedua-duanya meleraikan gigitan, tubuh mereka masih tersentak. Seekor terhempas ke pintu besi. Seekor lagi turun perlahan-lahan ke dasar tanpa sempat mengibas ekornya.',
        englishText:
          'At the sunken palong gate, two catfish fought over a narrow passage and sank their teeth into one another. Venom from an earlier strike still coursed through their wounds. Long after they broke apart, their bodies twitched. One slammed against the iron gate; the other drifted down to the floor without another flick of its tail.',
      },
      {
        id: '3-2',
        sceneKey: 'p3_hiding_stone',
        malayText:
          'Keli yang paling kecil menghabiskan seluruh pergelutan itu di bawah seketul batu. Ia keluar hanya apabila kelodak sudah mendap. Mula-mula ditelannya bangkai yang pertama, yang membawa empat cebisan. Kemudian bangkai yang kedua, yang membawa lima. Bersama cebisan yang sejak awal tersimpan di dalam tubuhnya, kini ada sepuluh yang masih hidup.',
        englishText:
          'The smallest catfish waited out the entire struggle beneath a stone, emerging only once the silt settled. First it swallowed the first carcass, carrying four fragments. Then the second, carrying five. With the single fragment it already held, ten now lived inside it.',
      },
      {
        id: '3-3',
        sceneKey: 'p3_memory_hand',
        malayText:
          'Dengan sekali libas ekor, ia meluru sepanjang palong sebelum sempat arus menutup jejaknya. Di tengah-tengah deru air itu, datang satu ingatan yang begitu jelas sehingga untuk seketika ia terlupa berenang. Pernah ada tangan seorang anak di dalam genggamannya. Tangan itu terlepas kerana anak itu mahu berlari dahulu dan menunggunya di hadapan.',
        englishText:
          'With a single Riptide Dash of its tail, it surged along the palong before the current erased its wake. Amid the roaring water came a memory so vivid that for a moment it forgot to swim. There had once been a child’s hand inside its grasp—letting go only because she wanted to run ahead and wait up front.',
      },
    ],
  },
  {
    pageNumber: 4,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'TAHAP 10 → 40 · 04 / 08',
    title: 'Tebing',
    englishTitle: 'The Bank',
    panels: [
      {
        id: '4-1',
        sceneKey: 'p4_echo_cave',
        malayText:
          'Selepas menelan satu lagi bangkai, dengung air yang selama ini memenuhi kepalanya mula berpecah menjadi gema. Ia dapat mengesan lekuk dinding gua dan gerak ikan di balik bongkah berhampiran. Lama ia terapung dalam gelap, mengirim denyut demi denyut ke celah batu, menunggu satu bunyi yang mirip wisel dari lombong.',
        englishText:
          'After swallowing another carcass, the hum filling its head split into echoes. It could sense the curves of cave walls and the movement of fish behind nearby boulders. Long it drifted in the dark, sending pulse after pulse through stone crevices, listening for something like the mine’s shift whistle.',
      },
      {
        id: '4-2',
        sceneKey: 'p4_toxic_clash',
        malayText:
          'Air beracun semakin merapat dari segala penjuru dan mengasak ikan yang masih hidup ke Jantung Tasik. Di kolam terakhir yang masih jernih, dua ekor keli bertarung di permukaan. Di bawah percikan dan libasan ekor, seekor yang lebih kecil mengekori bangkai yang sedang tenggelam. Ia menelan bangkai itu sebelum kedua-dua petarung menyedari apa yang sudah terlepas daripada mereka.',
        englishText:
          'Contaminated water closed in from every direction, herding the survivors toward Jantung Tasik. In the final clear pool, two large catfish clashed at the surface. Beneath their thrashing, a smaller creature trailed a sinking carcass and swallowed it before either duelist realized what had slipped past them.',
      },
      {
        id: '4-3',
        sceneKey: 'p4_arms_grow',
        malayText:
          'Apabila empat puluh cebisan berkumpul di dalam dirinya, tumbuh sepasang lengan dari sisi tubuhnya. Cakarnya mencengkam batu, lalu ia mengheret seluruh ekor ikannya keluar dari air. Sebaik sahaja tapak tangannya menyentuh tanah, jari-jarinya tahu di mana harus berpaut. Yang asing baginya ialah perasaan bahawa tangan itu pernah digunakan untuk sesuatu yang lebih halus daripada mencengkam batu.',
        englishText:
          'When forty fragments gathered inside its body, a pair of arms grew from its flanks. Its claws gripped rock and hauled its fish tail out of the water. The moment its palms touched earth, its fingers knew where to hold. What felt strange was the sensation that these hands had once done something gentler than gripping stone.',
      },
    ],
  },
  {
    pageNumber: 5,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'TAHAP 40 → 80 · 05 / 08',
    title: 'Sepuluh Saat',
    englishTitle: 'Ten Seconds',
    panels: [
      {
        id: '5-1',
        sceneKey: 'p5_boat_roots',
        malayText:
          'Arus dari arah rumah-rumah membawa sebuah perahu kertas merah hingga tersangkut pada akar. Air telah melunturkan warnanya dan melengkungkan sisinya, tetapi lipatan di muncung masih bertahan. Dengan kedua-dua lengannya, ia mengheret ekor merentasi tebing yang basah. Di hadapannya, perahu itu terangkat sedikit setiap kali air menyentuh akar.',
        englishText:
          'Currents from upstream carried a red paper boat until it snagged on tree roots. Water had faded its dye and warped its sides, yet the double-folded prow endured. With both arms it dragged its tail across the wet bank. Before it, the paper boat lifted slightly each time ripples touched the roots.',
      },
      {
        id: '5-2',
        sceneKey: 'p5_ten_seconds',
        malayText:
          'Pada saat kesepuluh, hujung cakarnya sudah hampir menyentuh kertas. Sesaat kemudian, berat seluruh tubuhnya jatuh ke atas kedua-dua lengannya. Nafasnya semakin pendek. Ia meraba batu untuk memusingkan badan dan menggeliat semula ke dalam tasik. Ketika kepalanya tenggelam, perahu itu masih di tempat tadi, dalam jarak yang mungkin dapat dicapai oleh seorang anak kecil.',
        englishText:
          'On the tenth second, the tip of its claw nearly brushed the paper. A heartbeat later, its body collapsed onto its arms as its breath shortened. It felt along the stone to turn around and slither back into the lake. As its head submerged, the boat remained where it lay—within arm’s reach of a small child.',
      },
      {
        id: '5-3',
        sceneKey: 'p5_storm_hunt',
        malayText:
          'Sejak itu, waktu berlalu dalam kelodak dan kilat. Setiap kali ia menelan lawan, tubuhnya belajar menggunakan sesuatu yang dibawa oleh lawan itu. Ia mengeruhkan air untuk menghilang, kemudian menggunakan renjatan untuk menyentak bayang yang memburunya dari balik lumpur. Setiap kali timbul, ia memeriksa akar itu dahulu, sebelum mencari tanda ikan lain.',
        englishText:
          'From then on, time passed in silt and lightning. Each rival it swallowed taught its body a new ability: clouding the water with Silt Veil to vanish, then firing Electroshock to stun shadows stalking it from the mud. Whenever it surfaced, it checked those roots first before hunting again.',
      },
    ],
  },
  {
    pageNumber: 6,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'TAHAP 80 · 06 / 08',
    title: 'Pemburu',
    englishTitle: 'The Hunter',
    panels: [
      {
        id: '6-1',
        sceneKey: 'p6_legs_shore',
        malayText:
          'Setelah lapan puluh cebisan terkumpul, tumbuh sepasang kaki yang dapat menanggung berat tubuhnya. Ia memijak pelantar batu kapur dengan berhati-hati, seakan-akan tebing itu boleh patah di bawahnya seperti papan lama. Ia mengira sampai sepuluh, kemudian sebelas. Kakinya masih kukuh, dan buat pertama kali di darat, ia dapat berhenti untuk menarik nafas.',
        englishText:
          'Once eighty fragments converged, a pair of legs grew capable of bearing its weight. It stepped onto the limestone ledge cautiously, as though the bank might snap beneath it like an old bridge plank. It counted to ten, then eleven. Its legs held firm—and for the first time ashore, it could pause to breathe.',
      },
      {
        id: '6-2',
        sceneKey: 'p6_hunter_sonar',
        malayText:
          'Denyutnya kini dapat merentas seluruh tasik dan menjejaki setiap keli hidup yang lebih rendah tahapnya. Ada seekor di bawah pintu palong dan dua ekor lagi di seberang selekoh. Ia mendengar ketiga-tiganya dengan jelas. Di celah denyut mereka yang berjauhan itu, sudah begitu banyak ruang kosong sehingga ia mula tertanya-tanya bunyi apa yang akan tinggal selepas semuanya senyap.',
        englishText:
          'Its Hunter Sonar pulse now spanned the entire lake, tracking every living catfish of lower level. One crouched beneath the palong gate and two more beyond the bend. It heard all three clearly. Between their distant pulses lay so much empty space that it began wondering what sound would remain once everything fell silent.',
      },
      {
        id: '6-3',
        sceneKey: 'p6_palong_grapple',
        malayText:
          'Keli yang menunggu di bawah pintu palong menerkamnya dari bawah. Hentaman itu menghempaskan tubuhnya ke besi lombong sehingga kelodak terangkat dari dasar. Sebelum sempat ia berpusing, lawannya sudah menerkam sekali lagi. Ia membalas dengan kedua-dua lengan, menahan tubuh licin itu rapat ke palong sementara arus menyapu lumpur di sekeliling mereka.',
        englishText:
          'The catfish waiting beneath the palong gate ambushed from below, slamming it against the mine iron and kicking silt up from the floor. Before it could turn, its foe lunged again. It countered with both arms, pinning the slick body tight against the sluice as current swept mud around them.',
      },
    ],
  },
  {
    pageNumber: 7,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'TAHAP 80 → 100 · 07 / 08',
    title: 'Raja Keli',
    englishTitle: 'The Keli King',
    panels: [
      {
        id: '7-1',
        sceneKey: 'p7_maelstrom',
        malayText:
          'Selepas menelan lawan di pintu palong, ia membawa sembilan puluh cebisan. Air mula berputar di sekeliling tubuhnya, semakin laju sehingga dua keli terakhir terseret masuk. Ia berpaut pada palong yang patah sambil merasai kedua-duanya meronta dalam pusaran. Apabila arus reda, ia berenang turun untuk memungut apa yang tinggal daripada mereka.',
        englishText:
          'After swallowing the rival at the palong gate, it held ninety fragments. The water began spinning around its body, accelerating until the final two catfish were dragged into the Maelstrom. It clung to the broken timber as both thrashed inside the vortex. When the current calmed, it swam down to gather what remained.',
      },
      {
        id: '7-2',
        sceneKey: 'p7_keli_king',
        malayText:
          'Kesemua seratus cebisan kini hidup di dalam satu tubuh. Raja Keli muncul dari tasik dengan bahu yang lebih lebar daripada pintu rumah lamanya. Air mencurah dari sesungutnya, dan mata hitamnya tetap dingin. Dia menunggu dalam lingkaran riak yang semakin luas. Dari bawah air, tiada satu pun denyut membalas.',
        englishText:
          'All one hundred fragments now lived within one body. The Keli King rose from the lake with shoulders broader than the doorway of his old house. Water poured from his barbels, and his black eyes stayed cold. He waited inside widening ripples. From beneath the water, not a single pulse answered.',
      },
      {
        id: '7-3',
        sceneKey: 'p7_claw_boat',
        malayText:
          'Di tebing, dia menyelitkan hujung cakar di bawah perahu merah dan mengangkatnya perlahan-lahan daripada akar. Di sebelah dalam lipatan, masih ada nama Aisyah dalam tulisan yang menekan kertas terlalu kuat. Dia ingat bahawa dia pernah berjanji akan pulang. Kemudian dia ingat apa yang dimintanya daripada anak itu sebagai balasan. Tunggu.',
        englishText:
          'On the bank, he slipped the tip of a claw beneath the red boat and lifted it gently from the roots. Inside the fold, Aisyah’s name remained in pencil pressed too hard into the paper. He remembered promising he would come home—and remembered what he had asked of the child in return. Wait.',
      },
    ],
  },
  {
    pageNumber: 8,
    headerLeft: 'AWANG KELI / SETELAH TASIK SENYAP',
    headerRight: 'EPILOG · 08 / 08',
    title: 'Ke Hulu',
    englishTitle: 'Upstream',
    panels: [
      {
        id: '8-1',
        sceneKey: 'p8_rain_boats',
        malayText:
          'Dahulu, pada hari hujan, Aisyah suka melepaskan dua perahu serentak ke dalam alur di tepi rumah. Jika sebuah tersangkut, yang sebuah lagi masih boleh meneruskan perjalanan. Awang selalu berdiri bersamanya di ambang pintu, menunggu sehingga perahu terakhir hilang di selekoh. Sesudah itu pun Aisyah kadang-kadang tetap di situ, seperti masih ada sesuatu yang boleh dilihat.',
        englishText:
          'Long ago, on rainy days, Aisyah loved releasing two paper boats together into the ditch beside their home—so if one snagged, the other could still continue downstream. Awang always stood beside her in the doorway until the last boat vanished around the bend. Even after, Aisyah sometimes lingered, as if something still remained to be seen.',
        dialogue: {
          speaker: 'AISYAH',
          malay: 'Ayah tengok sampai dia lepas selekoh, na?',
          english: 'Watch until it clears the bend, okay Dad?',
        },
      },
      {
        id: '8-2',
        sceneKey: 'p8_empty_house',
        malayText:
          'Dari seberang air, dia melihat tingkap rumah mereka gelap dan pintunya kosong. Di tempat Aisyah dahulu menunggunya, dia berdiri sambil melindungi perahu itu daripada hujan dengan kedua-dua tangannya. Pendengarannya dapat menangkap titis air pada talang rumah yang jauhnya tiga selekoh. Dia mendengar lama, tetapi suara yang ditunggunya tidak kedengaran.',
        englishText:
          'From across the water, he saw their house windows dark and the doorway empty. Where Aisyah used to wait for him, he stood shielding the paper boat from the rain with both hands. His hearing caught raindrops hitting eaves three bends away. He listened for a long time, yet the voice he waited for never came.',
      },
      {
        id: '8-3',
        sceneKey: 'p8_kampung_road',
        malayText:
          'Menjelang pagi, Awang Keli meninggalkan tasik dan menyusuri jalan kampung yang melengkung di kaki bukit. Setiap kali air menitis dari dahinya, dia menjauhkan perahu itu sedikit daripada tubuhnya agar nama yang tertulis di dalamnya tidak luntur. Di selekoh pertama, dia berhenti dan memanggil anaknya. Kemudian dia berjalan lagi, cukup perlahan untuk mendengar jika ada yang menyahut.',
        englishText:
          'Toward morning, Awang Keli left the lake and followed the village road curving at the foot of the limestone hills. Each time water dripped from his brow, he held the boat a little farther from his chest so the name written inside would not blur. At the first bend, he stopped and called out for his child—then walked on slowly enough to hear if anyone answered.',
        dialogue: {
          speaker: 'AWANG KELI',
          malay: 'Aisyah.',
          english: 'Aisyah.',
        },
      },
    ],
  },
];
