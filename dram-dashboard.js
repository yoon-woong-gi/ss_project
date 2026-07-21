  (() => {
    "use strict";

    // ---------- Grid geometry ----------
    const NUM_ROWS = 8;
    const NUM_COLS = 16;
    const GRID_X = 132;
    const GRID_Y = 62;
    const CELL_W = 34;
    const CELL_H = 28;
    const STRIDE_X = 42;
    const STRIDE_Y = 34;
    const GRID_W = STRIDE_X * NUM_COLS - (STRIDE_X - CELL_W); // = 42*16-8 = 664
    const GRID_H = STRIDE_Y * NUM_ROWS - (STRIDE_Y - CELL_H); // = 34*8-6  = 266
    const SA_Y = GRID_Y + GRID_H + 42; // sense amp row Y
    const DQ_Y = SA_Y + 62; // DQ bus Y

    // ---------- Sensing-waveform geometry (bottom of stage) ----------
    // Faithful reproduction of the classic DRAM sensing diagram:
    // wordline / bitline / SAP / SAN / CSL voltages across
    // Precharge · Access · Sense · Restore · Precharge, with tRCD/tRAS/tRP.
    const WAVE_X0 = 172;
    const WAVE_X1 = 858;
    const WAVE_W = WAVE_X1 - WAVE_X0;
    const waveX = (f) => WAVE_X0 + f * WAVE_W;
    const G_VCCVT = 470; // Vcc + Vt (boosted word line)
    const G_VCC = 492; // Vcc
    const G_VREF = 524; // Vcc/2 (precharge reference)
    const G_GND = 566; // Gnd baseline
    const G_PHASE = 584; // phase arrow row
    const G_BRK1 = 604; // tRCD / tRP bracket row
    const G_BRK2 = 622; // tRAS bracket row
    const gLevel = {
      vt: G_VCCVT,
      vcc: G_VCC,
      ref: G_VREF,
      bump: G_VREF - 9, // small charge-sharing rise above Vdd/2
      dip: G_VREF + 7, // small precharge dip below Vdd/2
      settle: G_VCC + 6, // slight settle after the bit line first reaches Vdd
      gnd: G_GND,
    };

    // Static curve / phase / bracket data (shared by all scenarios).
    const SENSE = {
      phases: [
        { name: "Precharge", x0: 0, x1: 0.14 },
        { name: "Access", x0: 0.14, x1: 0.36 },
        { name: "Sense", x0: 0.36, x1: 0.56 },
        { name: "Restore", x0: 0.56, x1: 0.82 },
        { name: "Precharge", x0: 0.82, x1: 1.0 },
      ],
      circles: [
        { x: 0.07, n: 0 },
        { x: 0.3, n: 1 },
        { x: 0.46, n: 2 },
        { x: 0.68, n: 3 },
      ],
      curves: [
        {
          cls: "wave-wl",
          label: "wordline",
          lx: 0.19,
          ly: (G_VREF + G_VCC) / 2 - 2,
          a: [
            [0, "gnd"],
            [0.16, "gnd"],
            [0.3, "vt"],
            [0.84, "vt"],
            [0.9, "gnd"],
            [1, "gnd"],
          ],
        },
        {
          cls: "wave-bl",
          label: "Bitline",
          lx: 0.4,
          ly: G_VREF - 12,
          dash: true,
          a: [
            [0, "ref"],
            [0.03, "dip"],
            [0.08, "ref"],
            [0.14, "ref"],
            [0.3, "bump"],
            [0.4, "bump"],
            [0.5, "vcc"],
            [0.54, "settle"],
            [0.58, "vcc"],
            [0.84, "vcc"],
            [0.9, "ref"],
            [1, "ref"],
          ],
        },
        {
          cls: "wave-sap",
          label: "SAP",
          lx: 0.58,
          ly: G_VCC + 4,
          a: [
            [0, "ref"],
            [0.4, "ref"],
            [0.54, "vcc"],
            [0.84, "vcc"],
            [0.9, "ref"],
            [1, "ref"],
          ],
        },
        {
          cls: "wave-san",
          label: "SAN",
          lx: 0.45,
          ly: G_VREF + 18,
          a: [
            [0, "ref"],
            [0.4, "ref"],
            [0.54, "gnd"],
            [0.84, "gnd"],
            [0.9, "ref"],
            [1, "ref"],
          ],
        },
        {
          cls: "wave-csl",
          label: "CSL",
          lx: 0.76,
          ly: G_VCC + 4,
          a: [
            [0, "gnd"],
            [0.62, "gnd"],
            [0.72, "vcc"],
            [0.84, "vcc"],
            [0.9, "gnd"],
            [1, "gnd"],
          ],
        },
      ],
      brackets: [
        { key: "tRCD", x0: 0.14, x1: 0.56, label: "tRCD", row: 0 },
        { key: "tRAS", x0: 0.14, x1: 0.82, label: "tRAS", row: 1 },
        { key: "tRP", x0: 0.82, x1: 1.0, label: "tRP", row: 0 },
      ],
      levels: [
        { y: G_VCCVT, label: "Vdd+Vt", dash: true },
        { y: G_VCC, label: "Vdd", dash: true },
        { y: G_VREF, label: "(Vref) Vdd/2", dash: false },
        { y: G_GND, label: "Gnd", dash: false },
      ],
    };

    // ---------- 1T1C detail-view geometry ----------
    const D_BL = 372; // bit line BL x
    const D_BLB = 588; // bit line BL/ x
    const D_TOP = 74; // top of bit lines
    const D_WL = 128; // word line y
    const D_SA_T = 250; // sense-amp box top
    const D_SA_B = 392; // sense-amp box bottom

    const cellX = (c) => GRID_X + c * STRIDE_X;
    const cellY = (r) => GRID_Y + r * STRIDE_Y;
    const cellCX = (c) => cellX(c) + CELL_W / 2;
    const cellCY = (r) => cellY(r) + CELL_H / 2;

    // ---------- Scenarios ----------
    // Correctness notes:
    //  - ACT drives one word line; sense amps then latch entire row (row buffer). tRCD covers ACT→col-cmd.
    //  - Because word line is still on during sense/restore, cells are automatically restored.
    //    Precharge just closes the row and equalises bit lines to Vdd/2.
    //  - WRITE requires row to be open; write drivers overpower sense amps, cell is updated
    //    while word line is still asserted. tWR is needed before PRE.
    //  - REF uses internal counter (no row address on bus), refreshes 1..N rows per command,
    //    all banks must be precharged. tREFI 7.8us, tREFW 64ms, tRFC ~350ns typical.
    const TARGET_ROW = 3;
    const TARGET_COL = 6;

    const IDLE_STATE = {
      wordlines: [],
      bitlines: [],
      hitCol: null,
      cellPhase: "idle",
      senseAmpPhase: "idle",
      dqPhase: "idle",
      rowAddr: "—",
      colAddr: "—",
      bus: [],
      highlightTiming: null,
    };

    const scenarios = {
      read: {
        label: { en: "READ", ko: "읽기" },
        color: "read",
        // Playhead position per step, mapped onto the sensing phases
        // (Precharge · Access · Sense · Restore · Precharge).
        wave: { pos: [0.07, 0.2, 0.3, 0.46, 0.66, 0.7, 0.76, 0.9] },
        profile: {
          en: "DDR4-3200 · JEDEC 22-22-22-52",
          ko: "DDR4-3200 · JEDEC 22-22-22-52",
        },
        timings: [
          {
            name: "tRCD",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "ACT → column cmd", ko: "ACT → column 명령" },
            key: "tRCD",
          },
          {
            name: "CL",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "RD → first DQ", ko: "RD → 첫 DQ 출력" },
            key: "CL",
          },
          {
            name: "BL",
            value: { en: "8 beats", ko: "8 비트" },
            desc: { en: "burst length", ko: "burst 길이" },
            key: null,
            termKey: "BL8",
          },
          {
            name: "tRAS",
            value: { en: "52 cyc · 32.5 ns", ko: "52 cyc · 32.5 ns" },
            desc: { en: "ACT → PRE min", ko: "ACT → PRE 최소" },
            key: "tRAS",
          },
          {
            name: "tRP",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "PRE → next ACT", ko: "PRE → 다음 ACT" },
            key: "tRP",
          },
        ],
        steps: [
          {
            op: { en: "IDLE", ko: "유휴" },
            title: { en: "Precharged / Idle", ko: "Precharge 상태 / 유휴" },
            desc: {
              en: "The bank is idle. Every bit line sits at <code>Vdd/2</code> and no word line is on. A row must be opened before any column can be read.",
              ko: "Bank가 idle 상태입니다. 모든 bit line은 <code>Vdd/2</code>에 있고 켜진 word line은 없습니다. 어떤 column을 읽으려면 먼저 row를 열어야 합니다.",
            },
            state: { ...IDLE_STATE },
          },
          {
            op: { en: "ACT · row 0x3", ko: "ACT · row 0x3" },
            title: { en: "ACT — Row Activate", ko: "ACT — row 활성화" },
            desc: {
              en: "The controller sends <code>ACTIVATE</code> with a row address. Word line <code>0x3</code> rises to the boosted voltage <code>Vpp</code>, turning on every transistor in row 3.",
              ko: "컨트롤러가 row 주소와 함께 <code>ACTIVATE</code>를 보냅니다. Word line <code>0x3</code>이 부스트 전압 <code>Vpp</code>까지 올라가며 row 3의 모든 transistor를 켭니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              cellPhase: "wl",
              rowAddr: "0x3",
              bus: ["ACT"],
            },
          },
          {
            op: { en: "SENSE · charge sharing", ko: "SENSE · 전하 공유" },
            title: { en: "Charge Sharing", ko: "전하 공유" },
            desc: {
              en: "Now we zoom into one cell. <code>BL</code> and <code>BL/</code> were both precharged to <code>Vdd/2</code>. With word line 3 on, the storage capacitor shares its charge with BL: a stored <code>1</code> pulls BL a little <em>above</em> Vdd/2, a stored <code>0</code> a little <em>below</em>. BL/ is left untouched at Vdd/2 as the reference.",
              ko: "이제 셀 하나를 확대해서 보겠습니다. <code>BL</code>과 <code>BL/</code>은 둘 다 <code>Vdd/2</code>로 precharge된 상태입니다. Word line 3이 켜지면 셀 capacitor가 BL과 전하를 나눠 갖습니다. 셀에 <code>1</code>이 들어 있으면 BL이 Vdd/2보다 살짝 <em>올라가고</em>, <code>0</code>이면 살짝 <em>내려갑니다</em>. BL/는 그대로 Vdd/2에 두고 비교 기준으로 씁니다.",
            },
            state: {
              ...IDLE_STATE,
              view: "detail",
              wordlines: [TARGET_ROW],
              cellPhase: "sharing",
              rowAddr: "0x3",
              bus: ["ACT"],
            },
          },
          {
            op: { en: "SENSE · amplify", ko: "SENSE · 증폭" },
            title: { en: "Sense & Amplify", ko: "센싱 및 증폭" },
            desc: {
              en: "The sense amp develops the two bit lines apart, driving the higher one up to <code>Vdd</code> and the lower one down to <code>0</code>. ACT to here is <code>tRCD</code>.",
              ko: "Sense amp가 두 bit line을 서로 반대 방향으로 develop해, 높은 쪽은 <code>Vdd</code>로 낮은 쪽은 <code>0</code>으로 만듭니다. ACT부터 여기까지가 <code>tRCD</code>입니다.",
            },
            state: {
              ...IDLE_STATE,
              view: "detail",
              wordlines: [TARGET_ROW],
              cellPhase: "sensed",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              bus: ["ACT"],
              highlightTiming: "tRCD",
            },
          },
          {
            op: { en: "SENSE · restore", ko: "SENSE · 복원" },
            title: { en: "Restore", ko: "복원" },
            desc: {
              en: "Reading is destructive. Charge sharing has already pulled the capacitor down toward <code>Vdd/2</code>, so the original value is gone. Because word line 3 is still on, the bit line, now driven to <code>Vdd</code> or <code>0</code>, flows back through the transistor and recharges the capacitor to its original value. The cell is restored and can be read again.",
              ko: "읽고 나면 셀의 원래 값은 사라집니다. 전하 공유 과정에서 capacitor가 <code>Vdd/2</code> 부근까지 내려갔기 때문입니다. 다만 word line 3이 아직 켜져 있어, <code>Vdd</code> 또는 <code>0</code>으로 구동된 bit line이 transistor를 통해 다시 흘러 들어가 capacitor를 원래 값으로 재충전합니다. 이로써 셀이 원래 상태로 복원되어 다시 읽을 수 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              view: "detail",
              wordlines: [TARGET_ROW],
              cellPhase: "restore",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              bus: ["ACT"],
            },
          },
          {
            op: { en: "RD · col 0x6", ko: "RD · column 0x6" },
            title: { en: "RD — Column Select", ko: "RD — column 선택" },
            desc: {
              en: "The controller sends <code>READ</code> with column address <code>0x6</code>. The column decoder picks column 6 and connects it to the read path. The data itself only comes out after <code>CL</code>.",
              ko: "컨트롤러가 column 주소 <code>0x6</code>과 함께 <code>READ</code>를 보냅니다. Column decoder가 column 6을 골라 읽기 경로에 이어 줍니다. 실제 데이터는 <code>CL</code>만큼 지난 뒤에야 나옵니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "restore",
              senseAmpPhase: "reading",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "RD"],
            },
          },
          {
            op: { en: "CL · data out", ko: "CL · 데이터 출력" },
            title: { en: "CL → Data Out", ko: "CL → 데이터 출력" },
            desc: {
              en: "After <code>CL</code>, the selected data leaves the cell and heads out to the controller.",
              ko: "<code>CL</code>이 지나면 고른 데이터가 셀에서 빠져나와 컨트롤러로 전달됩니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "restore",
              senseAmpPhase: "reading",
              dqPhase: "burst",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "RD"],
              highlightTiming: "CL",
            },
          },
          {
            op: { en: "PRE", ko: "PRE" },
            title: { en: "PRE — Precharge", ko: "PRE — Precharge" },
            desc: {
              en: "<code>PRECHARGE</code> closes the row. Word line 3 drops and the bit lines return to <code>Vdd/2</code>. After <code>tRP</code> the bank is ready for another ACT.",
              ko: "<code>PRECHARGE</code>가 row를 닫습니다. Word line 3이 내려가고 bit line이 다시 <code>Vdd/2</code>로 돌아갑니다. <code>tRP</code>가 지나면 bank는 다음 ACT를 받을 수 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              bus: ["ACT", "RD", "PRE"],
              highlightTiming: "tRP",
            },
          },
        ],
      },

      write: {
        label: { en: "WRITE", ko: "쓰기" },
        color: "write",
        // Playhead per step on the shared sensing diagram; the appended
        // leak/refresh steps park on the final Precharge / Restore phases.
        wave: {
          pos: [0.07, 0.2, 0.48, 0.66, 0.7, 0.74, 0.78, 0.88, 0.92, 0.72],
        },
        profile: {
          en: "DDR4-3200 · JEDEC (CWL16)",
          ko: "DDR4-3200 · JEDEC (CWL16)",
        },
        timings: [
          {
            name: "tRCD",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "ACT → column cmd", ko: "ACT → column 명령" },
            key: "tRCD",
          },
          {
            name: "CWL",
            value: { en: "16 cyc · 10 ns", ko: "16 cyc · 10 ns" },
            desc: { en: "WR → first data", ko: "WR → 첫 데이터" },
            key: "CWL",
          },
          {
            name: "BL",
            value: { en: "8 beats", ko: "8 비트" },
            desc: { en: "burst length", ko: "burst 길이" },
            key: null,
            termKey: "BL8",
          },
          {
            name: "tWR",
            value: { en: "24 cyc · 15 ns", ko: "24 cyc · 15 ns" },
            desc: { en: "last data → PRE", ko: "마지막 데이터 → PRE" },
            key: "tWR",
          },
          {
            name: "tRP",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "PRE → next ACT", ko: "PRE → 다음 ACT" },
            key: "tRP",
          },
          {
            name: "tREFW",
            value: { en: "64 ms", ko: "64 ms" },
            desc: { en: "retention window", ko: "유지 시간" },
            key: "tREFW",
          },
          {
            name: "tREFI",
            value: { en: "7.8 μs", ko: "7.8 μs" },
            desc: { en: "avg REF interval", ko: "평균 REF 간격" },
            key: "tREFI",
          },
        ],
        steps: [
          {
            op: { en: "IDLE", ko: "유휴" },
            title: { en: "Precharged / Idle", ko: "Precharge 상태 / 유휴" },
            desc: {
              en: "The bank is idle. Bit lines at <code>Vdd/2</code>, no word line on. A write also needs the target row opened first.",
              ko: "Bank가 idle 상태입니다. Bit line은 <code>Vdd/2</code>에 있고 켜진 word line은 없습니다. 쓰기도 먼저 대상 row를 열어야 합니다.",
            },
            state: { ...IDLE_STATE },
          },
          {
            op: { en: "ACT · row 0x3", ko: "ACT · row 0x3" },
            title: { en: "ACT — Row Activate", ko: "ACT — row 활성화" },
            desc: {
              en: "The controller sends <code>ACTIVATE</code> with row <code>0x3</code>. Word line 3 rises and every transistor in the row turns on, exactly the same as a read. Activation is identical whether a read or a write follows.",
              ko: "컨트롤러가 row <code>0x3</code>과 함께 <code>ACTIVATE</code>를 보냅니다. Word line 3이 올라가고 row의 모든 transistor가 켜집니다. 읽기와 완전히 동일하며, 활성화는 뒤에 읽기가 오든 쓰기가 오든 같습니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              cellPhase: "wl",
              rowAddr: "0x3",
              bus: ["ACT"],
            },
          },
          {
            op: { en: "SENSE · row open", ko: "SENSE · row 열기" },
            title: { en: "Sense & Restore", ko: "센싱 및 복원" },
            desc: {
              en: "Same physics as a read. With word line 3 on, <code>BL</code> develops from <code>Vdd/2</code> up to <code>Vdd</code> (or down to <code>0</code>), and the sense amp latches and restores the cell's current value. Only once the cell is held open like this can its column be overwritten. ACT to here is <code>tRCD</code>.",
              ko: "읽을 때와 똑같은 원리입니다. Word line 3이 켜진 상태에서 <code>BL</code>이 <code>Vdd/2</code>에서 <code>Vdd</code>(또는 <code>0</code>)까지 develop되고, sense amp가 셀의 지금 값을 붙잡아 복원해 둡니다. 이렇게 셀이 열린 채로 유지돼야 해당 column을 덮어쓸 수 있습니다. ACT부터 여기까지가 <code>tRCD</code>입니다.",
            },
            state: {
              ...IDLE_STATE,
              view: "detail",
              wordlines: [TARGET_ROW],
              cellPhase: "restore",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              bus: ["ACT"],
              highlightTiming: "tRCD",
            },
          },
          {
            op: { en: "WR · col 0x6", ko: "WR · column 0x6" },
            title: { en: "WR — Write Command", ko: "WR — 쓰기 명령" },
            desc: {
              en: "The controller sends <code>WRITE</code> with column address <code>0x6</code>. The column decoder targets column 6, and the controller waits <code>CWL</code> before the new data arrives.",
              ko: "컨트롤러가 column 주소 <code>0x6</code>과 함께 <code>WRITE</code>를 보냅니다. Column decoder가 column 6을 지정하고, 컨트롤러는 <code>CWL</code>만큼 기다렸다가 새 데이터를 보냅니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "restore",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "WR"],
            },
          },
          {
            op: { en: "CWL · data in", ko: "CWL · 데이터 입력" },
            title: {
              en: "CWL → Data In",
              ko: "CWL → 데이터 입력",
            },
            desc: {
              en: "After <code>CWL</code>, the new data arrives and is written into the selected column 6.",
              ko: "<code>CWL</code>이 지나면 새 데이터가 도착해 고른 column 6 자리에 채워집니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "restore",
              senseAmpPhase: "writing",
              dqPhase: "incoming",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "WR"],
              highlightTiming: "CWL",
            },
          },
          {
            op: { en: "CELL WRITE-BACK", ko: "Cell write-back" },
            title: { en: "Cell Update", ko: "셀 업데이트" },
            desc: {
              en: "Word line 3 is still on, so the new value flows back through the transistor and charges the cell capacitor to its new state.",
              ko: "Word line 3이 아직 켜져 있어 새 값이 transistor를 통해 다시 흘러 셀 capacitor를 새 상태로 채웁니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "writing",
              senseAmpPhase: "writing",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "WR"],
            },
          },
          {
            op: { en: "tWR · recovery", ko: "tWR · 복구" },
            title: { en: "Write Recovery", ko: "쓰기 복구" },
            desc: {
              en: "The cell needs a little time (<code>tWR</code>) to charge fully before the row can be closed. Closing too early risks losing the write.",
              ko: "셀이 완전히 충전되려면 잠깐의 시간 <code>tWR</code>이 필요하며, 그 전에 row를 닫으면 쓰기를 잃을 수 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "restore",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "WR"],
              highlightTiming: "tWR",
            },
          },
          {
            op: { en: "PRE", ko: "PRE" },
            title: { en: "PRE — Precharge", ko: "PRE — Precharge" },
            desc: {
              en: "<code>PRECHARGE</code> closes the row and the bit lines return to <code>Vdd/2</code>. After <code>tRP</code> the bank is free again. The new data now lives in the cell capacitor.",
              ko: "<code>PRECHARGE</code>가 row를 닫고 bit line이 <code>Vdd/2</code>로 돌아갑니다. <code>tRP</code> 후 bank는 다시 자유롭습니다. 새 데이터는 이제 셀 capacitor에 저장되어 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              bus: ["ACT", "WR", "PRE"],
              highlightTiming: "tRP",
            },
          },
          {
            op: { en: "RETENTION", ko: "유지 (leak)" },
            title: { en: "Charge Leaks Away", ko: "전하 누설" },
            desc: {
              en: "The cell capacitor is tiny, so its charge slowly leaks away. Left alone, the stored bit would fade within the retention window <code>tREFW</code> (about 64 ms).",
              ko: "셀 capacitor는 매우 작아 전하가 서서히 새어 나갑니다. 그대로 두면 저장된 비트는 유지 시간 <code>tREFW</code>(약 64 ms) 안에 사라집니다.",
            },
            state: {
              ...IDLE_STATE,
              cellPhase: "leak",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: [],
              highlightTiming: "tREFW",
            },
          },
          {
            op: { en: "REF · refresh", ko: "REF · refresh" },
            title: { en: "REF — Refresh Restores It", ko: "REF — Refresh 복원" },
            desc: {
              en: "Before that happens, the DRAM refreshes the row on its own: it opens the row, the sense amps develop it again, and full charge is written back into the cell. This repeats about every <code>tREFI</code>, so the data is never lost.",
              ko: "그 전에 DRAM이 스스로 row를 refresh합니다: row를 열고 sense amp가 다시 develop해 셀에 전하를 가득 채워 넣습니다. 이 과정이 약 <code>tREFI</code>마다 반복되어 데이터는 사라지지 않습니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              cellPhase: "refresh",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["REF"],
              highlightTiming: "tREFI",
            },
          },
        ],
      },
    };

    // ---------- i18n / UI strings ----------
    const UI = {
      brandSub: {
        en: "1T1C · DDR4 command model",
        ko: "1T1C · DDR4 명령 모델",
      },
      metaArray: { en: "ARRAY", ko: "어레이" },
      metaProfile: { en: "PROFILE", ko: "프로파일" },
      stageLabel: { en: "CELL ARRAY / BANK 0", ko: "셀 어레이 / BANK 0" },
      legendIdle: { en: "Idle cell", ko: "유휴 셀" },
      legendWl: { en: "Word line asserted", ko: "Word line 활성" },
      legendSa: { en: "Sense amp latched", ko: "Sense amp 래치" },
      legendDq: { en: "DQ / bit-line active", ko: "DQ / bit line 활성" },
      panelStep: { en: "STEP", ko: "단계" },
      panelCommand: { en: "COMMAND BUS", ko: "명령 버스" },
      panelTiming: { en: "TIMING", ko: "타이밍" },
      btnReset: { en: "↺ RESET", ko: "↺ 초기화" },
      btnPrev: { en: "◀ PREV", ko: "◀ 이전" },
      btnPlay: { en: "▶ PLAY", ko: "▶ 재생" },
      btnPause: { en: "❚❚ PAUSE", ko: "❚❚ 일시정지" },
      btnNext: { en: "NEXT ▶", ko: "다음 ▶" },
      svgCellArray: { en: "CELL ARRAY", ko: "셀 어레이" },
      svgSenseAmps: { en: "SENSE AMPS", ko: "SENSE AMPS" },
      svgDqBus: { en: "DQ BUS", ko: "DQ 버스" },
      svgRowDec: { en: "ROW DEC", ko: "ROW DEC" },
      svgColDec: { en: "COL DEC", ko: "COL DEC" },
      svgDqOut: { en: "DQ →", ko: "DQ →" },
    };

    // ---------- Technical term definitions (for hover tooltips) ----------
    const TERM_DEFS = {
      REF: {
        name: "REF · Refresh",
        en: "Auto-refresh command. Restores charge on DRAM storage capacitors before leakage erases the stored bit. Every row must be refreshed at least once within the retention window (tREFW). DDR4 uses tREFW ≈ 64 ms at normal temperature.",
        ko: "Auto-refresh 명령. DRAM 저장 커패시터의 전하가 누설로 사라지기 전에 다시 채워 넣습니다. 모든 row는 유지 시간(tREFW) 안에 최소 한 번은 refresh되어야 합니다. DDR4는 정상 온도에서 tREFW ≈ 64 ms.",
      },
      RD: {
        name: "RD · Read",
        en: "Column-read command. Issued after ACT — the column decoder selects one column from the open row buffer and routes the value to the read data path. External DQ pins receive the data only after CL cycles.",
        ko: "Column read 명령. ACT 이후에 발행되어, column decoder가 열린 row buffer에서 한 column을 선택해 read 데이터 경로로 전달합니다. 외부 DQ 핀에는 CL 사이클이 지난 뒤에 데이터가 실립니다.",
      },
      WR: {
        name: "WR · Write",
        en: "Column-write command. Issued after ACT — the DRAM captures data driven on DQ by the controller CWL cycles later, and the write drivers force the value into the sense-amp row buffer at the target column.",
        ko: "Column write 명령. ACT 이후에 발행되어, 컨트롤러가 CWL 사이클 뒤에 DQ에 실어 보낸 데이터를 DRAM이 받아 sense-amp row buffer의 대상 column에 강제로 기록합니다.",
      },
      ACT: {
        name: "ACT · Activate",
        en: "Row-activate command. Raises the target word line so every transistor in that row turns on; the sense amps then latch the row into the row buffer. Only one row per bank can be active at a time.",
        ko: "Row 활성화 명령. 대상 word line을 올려 해당 row의 모든 transistor를 켜고, sense amp가 그 row를 row buffer로 래치합니다. Bank당 한 번에 하나의 row만 활성화될 수 있습니다.",
      },
      PRE: {
        name: "PRE · Precharge",
        en: "Precharge command. Drops the active word line and pulls the bit lines back to Vdd/2 via the equalizers. Required before another row in the same bank can be activated.",
        ko: "Precharge 명령. 활성 word line을 내리고 equalizer로 bit line을 다시 Vdd/2로 되돌립니다. 같은 bank의 다른 row를 활성화하기 전에 반드시 필요합니다.",
      },
      Active: {
        name: "Active state",
        en: "A row is active once it has been ACTed and remains latched in the sense-amp row buffer. Column commands (RD/WR) can only touch the currently active row of a bank.",
        ko: "Row가 ACT되어 sense-amp row buffer에 래치되어 있는 상태. Column 명령(RD/WR)은 bank의 현재 활성 row에만 동작합니다.",
      },
      tREFI: {
        name: "tREFI · Refresh Interval",
        en: "Average interval at which the controller must issue REF. Derived from retention (tREFW) divided by the number of refresh commands needed to cover the array. DDR4 uses 7.8 μs at normal temperature (halved above 85 °C).",
        ko: "컨트롤러가 REF 명령을 발행해야 하는 평균 간격. 유지 시간(tREFW)을 어레이 전체를 커버하는 데 필요한 refresh 횟수로 나눈 값. DDR4 기준 정상 온도 7.8 μs, 확장 온도(85 °C 초과)에서는 절반인 3.9 μs.",
      },
      tREFW: {
        name: "tREFW · Refresh Window",
        en: "Retention window — the longest any cell can go without a refresh before its stored charge decays past the sense threshold. DDR4 specifies 64 ms at normal temperature.",
        ko: "유지 시간(retention window) — 저장 전하가 sense 임계치 이하로 감쇠하기 전에 셀이 refresh 없이 버틸 수 있는 최대 시간. DDR4는 정상 온도 기준 64 ms.",
      },
      tRFC: {
        name: "tRFC · Refresh Cycle Time",
        en: "How long a REF command occupies the DRAM. No other commands can be accepted during tRFC. Scales with die density — DDR4 8 Gb chips are ≈350 ns.",
        ko: "REF 명령이 DRAM을 점유하는 시간. tRFC 동안 다른 명령은 받을 수 없습니다. 다이 밀도(density)가 높을수록 길어지며, DDR4 8 Gb 다이 기준 ≈350 ns.",
      },
      tRCD: {
        name: "tRCD · Row-to-Column Delay",
        en: "Minimum delay from ACT to the first column command (RD/WR). Covers charge sharing between cell and bit line plus sense-amp latching. DDR4-3200 JEDEC bin: 22 cyc / 13.75 ns.",
        ko: "ACT부터 첫 column 명령(RD/WR)까지의 최소 지연. 셀과 bit line 간 전하 공유 및 sense amp 래치 시간을 포함. DDR4-3200 JEDEC 기준 22 cyc / 13.75 ns.",
      },
      tRAS: {
        name: "tRAS · Row Active Time",
        en: "Minimum time a row must stay open after ACT before it can be precharged. Guarantees the storage capacitors are fully restored. DDR4-3200 JEDEC bin: 52 cyc / 32.5 ns.",
        ko: "ACT 후 row가 precharge되기 전까지 열린 채로 유지되어야 하는 최소 시간. 저장 커패시터에 전하가 완전히 복원되도록 보장. DDR4-3200 JEDEC 기준 52 cyc / 32.5 ns.",
      },
      tRP: {
        name: "tRP · Row Precharge Time",
        en: "Time from PRE to when the same bank can accept another ACT. Covers bit-line equalization back to Vdd/2. DDR4-3200 JEDEC bin: 22 cyc / 13.75 ns.",
        ko: "PRE 명령부터 같은 bank에 다음 ACT를 발행할 수 있을 때까지의 시간. Bit line이 Vdd/2로 equalize되기까지 필요. DDR4-3200 JEDEC 기준 22 cyc / 13.75 ns.",
      },
      tWR: {
        name: "tWR · Write Recovery",
        en: "Time from the last write beat until PRE can be issued. Ensures the target cell is fully charged before the row closes. DDR4 uses 24 cyc / 15 ns.",
        ko: "마지막 쓰기 비트부터 PRE를 발행할 수 있을 때까지의 시간. Row가 닫히기 전에 대상 셀이 완전히 충전되도록 보장. DDR4 기준 24 cyc / 15 ns.",
      },
      CL: {
        name: "CL · CAS Latency",
        en: "Clock cycles from the RD command to the first DQ data output. Reflects column access, sensing, and output pipeline delay. DDR4-3200 JEDEC standard bin: CL22.",
        ko: "RD 명령부터 첫 DQ 데이터 출력까지의 클록 사이클 수. Column 접근, sensing, 출력 파이프라인 지연이 반영됨. DDR4-3200 JEDEC 표준 bin은 CL22.",
      },
      CWL: {
        name: "CWL · CAS Write Latency",
        en: "Clock cycles from the WR command until the controller starts driving data on DQ. DDR4-3200 JEDEC standard: CWL16.",
        ko: "WR 명령부터 컨트롤러가 DQ에 첫 데이터를 실어 보낼 때까지의 클록 사이클 수. DDR4-3200 JEDEC 표준 CWL16.",
      },
      BL: {
        name: "BL · Bit Line",
        en: "The bit line — the vertical wire running down a column, connecting every cell's storage capacitor (through its access transistor) to the sense amp at the bottom. Held at Vdd/2 while idle; charge sharing with an accessed cell nudges it slightly above or below that level depending on the stored bit. BL/ is its complementary reference line, held at Vdd/2 for the sense amp to compare against.",
        ko: "Bit line — column을 따라 내려가며 각 셀의 저장 커패시터를 access transistor를 통해 하단의 sense amp에 연결하는 배선입니다. Idle 상태에서는 Vdd/2로 유지되고, 접근된 셀과 전하를 나누면 저장된 값에 따라 그보다 살짝 위 또는 아래로 움직입니다. BL/는 상보(reference) 라인으로, sense amp가 비교할 수 있도록 Vdd/2로 유지됩니다.",
      },
      BL8: {
        name: "BL8 · Burst Length 8",
        en: "Burst length of 8 beats — the standard DDR3/DDR4 transfer size. Eight beats span four clock cycles, captured on both rising and falling edges.",
        ko: "8 비트 burst 길이 — DDR3/DDR4의 표준 전송 크기. 4 클록 사이클에 걸쳐 8 비트, 상승/하강 엣지 모두에서 캡처.",
      },
      Vdd: {
        name: "Vdd · Supply Voltage",
        en: "DRAM core power rail. Bit lines are held at Vdd/2 in the precharged state so charge sharing swings symmetrically. DDR4 uses 1.2 V.",
        ko: "DRAM 코어 전원. Precharge 상태에서 bit line은 Vdd/2로 유지되어 전하 공유가 대칭적으로 흔들리도록 합니다. DDR4는 1.2 V.",
      },
      Vpp: {
        name: "Vpp · Boosted Word-Line Voltage",
        en: "A voltage higher than Vdd used to fully turn on the transistors so the cell capacitor can be charged to a full Vdd level rather than Vdd − Vth.",
        ko: "Vdd보다 높은 전압. Access transistor를 완전히 켜서 셀 커패시터가 Vdd − Vth가 아닌 온전한 Vdd 레벨까지 충전될 수 있게 합니다.",
      },
      DQ: {
        name: "DQ · Data Pins",
        en: "External I/O bus that carries read and write data between the DRAM and the memory controller. Idle (high-Z) except during a burst.",
        ko: "DRAM과 메모리 컨트롤러 사이에서 read/write 데이터를 전송하는 외부 I/O 버스. Burst 구간이 아닐 때는 idle (high-Z) 상태.",
      },
      "ROW DEC": {
        name: "Row Decoder",
        en: "Circuit that decodes the row address on the command bus into a single word-line select, driving that word line to Vpp on ACT so every transistor in the row turns on. One row decoder per bank.",
        ko: "Command bus로 들어온 row 주소를 디코딩해 하나의 word line을 선택하는 회로. ACT 시 그 word line을 Vpp까지 구동해 해당 row의 모든 transistor를 켭니다. Bank당 하나씩 존재.",
      },
      "COL DEC": {
        name: "Column Decoder",
        en: "Circuit that decodes the column address on the command bus and connects the chosen column of the sense-amp row buffer to the internal read/write data path. Activated on RD/WR.",
        ko: "Command bus로 들어온 column 주소를 디코딩해 sense-amp row buffer의 해당 column을 내부 read/write 데이터 경로에 연결하는 회로. RD/WR 명령 시 동작.",
      },
      "REF/W": {
        name: "REFs per Window · 8192",
        en: "Total REF commands issued per retention window. Derived as tREFW / tREFI = 64 ms / 7.8 μs ≈ 8192 per JEDEC. That count of REFs is exactly what covers every row in the array within one window.",
        ko: "유지 시간(tREFW) 동안 발행되는 REF 명령 총 횟수. JEDEC 표준에서 tREFW / tREFI = 64 ms / 7.8 μs ≈ 8192로 계산됨. 이 만큼의 REF가 있어야 어레이의 모든 row가 한 window 안에 refresh됩니다.",
      },
      REFbudget: {
        name: "REF Pooling Budget",
        en: "JEDEC allows the controller to postpone or pull-in up to 8 REF commands relative to the tREFI schedule. This gives scheduling flexibility for burst refresh or command-bus contention — but once the accumulated postpone count exceeds 8, retention margin starts eroding and data risks loss.",
        ko: "JEDEC 표준은 컨트롤러가 tREFI 스케줄 대비 최대 8개의 REF 명령을 지연(postpone) 또는 미리 발행(pull-in) 할 수 있도록 허용합니다. Burst refresh나 command bus 경쟁 상황에서 스케줄링 유연성을 제공하지만, 누적된 지연이 8을 초과하면 유지 마진이 소진되고 데이터 손실 위험이 생깁니다.",
      },
    };

    const t = (obj) =>
      obj && typeof obj === "object" && obj[S.lang] != null ? obj[S.lang] : obj;

    // ---------- State ----------
    const S = {
      scenario: "read",
      step: 0,
      playing: false,
      timer: null,
      lang: localStorage.getItem("dram-lang") === "ko" ? "ko" : "en",
      theme: localStorage.getItem("dram-theme") === "light" ? "light" : "dark",
    };

    // ---------- SVG build ----------
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.getElementById("svg");

    function el(name, attrs) {
      const e = document.createElementNS(NS, name);
      if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    const wlEls = []; // word lines
    const blEls = []; // bit lines
    const cellEls = []; // cells (indexed [row][col])
    const saEls = []; // sense amp per col
    let dqBusEl, dqLabelEl, dqParticleEl;
    let rowDecEl, rowDecValue, colDecEl, colDecValue;
    let gOverview, gDetail, gWave; // layer groups
    let detail = {}; // 1T1C detail-view element refs

    function buildSVG() {
      svg.innerHTML = "";

      // Ambient frame
      const gAmb = el("g");
      gAmb.appendChild(
        el("rect", {
          x: GRID_X - 20,
          y: GRID_Y - 26,
          width: GRID_W + 40,
          height: GRID_H + 90,
          class: "frame",
          rx: 2,
        }),
      );
      // Frame label
      const fl = el("text", {
        x: GRID_X - 18,
        y: GRID_Y - 32,
        class: "frame-label",
        id: "svg-cell-array-label",
      });
      fl.textContent = "CELL ARRAY";
      gAmb.appendChild(fl);
      svg.appendChild(gAmb);

      // Column axis ticks
      for (let c = 0; c < NUM_COLS; c++) {
        if (c % 2 === 0 || c === TARGET_COL) {
          const t = el("text", {
            x: cellCX(c),
            y: GRID_Y - 8,
            class: "axis-tick",
            "text-anchor": "middle",
            id: `col-tick-${c}`,
          });
          t.textContent = c.toString(16).toUpperCase();
          svg.appendChild(t);
        }
      }
      // Row axis ticks
      for (let r = 0; r < NUM_ROWS; r++) {
        const t = el("text", {
          x: GRID_X - 12,
          y: cellCY(r) + 3,
          class: "axis-tick",
          "text-anchor": "end",
          id: `row-tick-${r}`,
        });
        t.textContent = r.toString(16).toUpperCase();
        svg.appendChild(t);
      }

      // Word lines (behind cells)
      for (let r = 0; r < NUM_ROWS; r++) {
        const line = el("line", {
          x1: GRID_X - 8,
          y1: cellCY(r),
          x2: GRID_X + GRID_W + 8,
          y2: cellCY(r),
          class: "wordline",
        });
        wlEls.push(line);
        svg.appendChild(line);
      }

      // Bit lines (behind cells but in front of word lines)
      for (let c = 0; c < NUM_COLS; c++) {
        const line = el("line", {
          x1: cellCX(c),
          y1: GRID_Y - 4,
          x2: cellCX(c),
          y2: SA_Y - 6,
          class: "bitline",
        });
        blEls.push(line);
        svg.appendChild(line);
      }

      // Cells
      for (let r = 0; r < NUM_ROWS; r++) {
        cellEls[r] = [];
        for (let c = 0; c < NUM_COLS; c++) {
          const g = el("g", {
            class: "cell",
            transform: `translate(${cellX(c)},${cellY(r)})`,
          });
          g.appendChild(
            el("rect", {
              class: "cell-rect",
              x: 0,
              y: 0,
              width: CELL_W,
              height: CELL_H,
              rx: 1,
            }),
          );
          // Capacitor dot
          g.appendChild(
            el("circle", {
              class: "cell-cap",
              cx: CELL_W / 2,
              cy: CELL_H / 2,
              r: 3,
            }),
          );
          svg.appendChild(g);
          cellEls[r][c] = g;
        }
      }

      // Sense amp box
      const saBoxY = SA_Y - 4;
      svg.appendChild(
        el("rect", {
          x: GRID_X - 8,
          y: saBoxY,
          width: GRID_W + 16,
          height: 34,
          class: "frame",
          rx: 2,
        }),
      );
      const saLabel = el("text", {
        x: GRID_X - 18,
        y: saBoxY + 20,
        class: "frame-label",
        "text-anchor": "end",
        id: "svg-sense-amps-label",
      });
      saLabel.textContent = "SENSE AMPS";
      svg.appendChild(saLabel);

      // Sense amp triangles
      for (let c = 0; c < NUM_COLS; c++) {
        const cx = cellCX(c);
        const y0 = saBoxY + 6;
        const y1 = saBoxY + 22;
        const tri = el("polygon", {
          class: "sa",
          points: `${cx - 7},${y0} ${cx + 7},${y0} ${cx},${y1}`,
        });
        saEls.push(tri);
        svg.appendChild(tri);
        // Small stem down to DQ area
        svg.appendChild(
          el("line", {
            x1: cx,
            y1: y1 + 1,
            x2: cx,
            y2: DQ_Y - 6,
            class: "bitline",
          }),
        );
      }

      // DQ bus (horizontal aggregator)
      dqBusEl = el("line", {
        x1: GRID_X - 8,
        y1: DQ_Y,
        x2: GRID_X + GRID_W + 8,
        y2: DQ_Y,
        class: "dq-bus",
      });
      svg.appendChild(dqBusEl);
      // DQ arrow to right
      svg.appendChild(
        el("line", {
          x1: GRID_X + GRID_W + 8,
          y1: DQ_Y,
          x2: GRID_X + GRID_W + 60,
          y2: DQ_Y,
          class: "dq-bus",
          id: "dq-out",
        }),
      );
      dqLabelEl = el("text", {
        x: GRID_X + GRID_W + 68,
        y: DQ_Y + 4,
        class: "dq-label",
        id: "svg-dq-out-label",
      });
      dqLabelEl.textContent = "DQ →";
      svg.appendChild(dqLabelEl);

      // DQ label on left
      const dqLeft = el("text", {
        x: GRID_X - 18,
        y: DQ_Y + 4,
        class: "frame-label",
        "text-anchor": "end",
        id: "svg-dq-bus-label",
      });
      dqLeft.textContent = "DQ BUS";
      svg.appendChild(dqLeft);

      // DQ flowing particle (three dots to simulate a burst)
      for (let i = 0; i < 3; i++) {
        const p = el("circle", {
          class: "dq-particle",
          cx: GRID_X - 4 + i * 18,
          cy: DQ_Y,
          r: 3,
        });
        p.style.animationDelay = `${i * 0.15}s`;
        svg.appendChild(p);
        if (i === 0) dqParticleEl = [];
        dqParticleEl.push(p);
      }

      // Row decoder box (left side)
      const decW = 76,
        decH = 34;
      rowDecEl = el("rect", {
        x: 20,
        y: GRID_Y + GRID_H / 2 - decH / 2,
        width: decW,
        height: decH,
        class: "dec-box",
        rx: 2,
      });
      svg.appendChild(rowDecEl);
      const rowDecLabel = el("text", {
        x: 20 + decW / 2,
        y: GRID_Y + GRID_H / 2 - 4,
        class: "dec-label term",
        "text-anchor": "middle",
        id: "svg-row-dec-label",
        "data-term": "ROW DEC",
        tabindex: "0",
      });
      rowDecLabel.textContent = "ROW DEC";
      svg.appendChild(rowDecLabel);
      rowDecValue = el("text", {
        x: 20 + decW / 2,
        y: GRID_Y + GRID_H / 2 + 12,
        class: "dec-value",
        "text-anchor": "middle",
      });
      rowDecValue.textContent = "—";
      svg.appendChild(rowDecValue);
      // Connector line to grid
      svg.appendChild(
        el("line", {
          x1: 20 + decW,
          y1: GRID_Y + GRID_H / 2,
          x2: GRID_X - 8,
          y2: GRID_Y + GRID_H / 2,
          class: "wordline",
          style: "opacity:0.35",
        }),
      );

      // Column decoder box (top) — label stacked above value, like the row decoder
      const colBoxY = 6;
      colDecEl = el("rect", {
        x: GRID_X + GRID_W / 2 - decW / 2,
        y: colBoxY,
        width: decW,
        height: decH,
        class: "dec-box",
        rx: 2,
      });
      svg.appendChild(colDecEl);
      const colDecLabel = el("text", {
        x: GRID_X + GRID_W / 2,
        y: colBoxY + decH / 2 - 4,
        class: "dec-label term",
        "text-anchor": "middle",
        id: "svg-col-dec-label",
        "data-term": "COL DEC",
        tabindex: "0",
      });
      colDecLabel.textContent = "COL DEC";
      svg.appendChild(colDecLabel);
      colDecValue = el("text", {
        x: GRID_X + GRID_W / 2,
        y: colBoxY + decH / 2 + 12,
        class: "dec-value",
        "text-anchor": "middle",
      });
      colDecValue.textContent = "—";
      svg.appendChild(colDecValue);

      // Wrap everything built so far into the "array overview" layer.
      gOverview = el("g", { id: "g-overview" });
      while (svg.firstChild) gOverview.appendChild(svg.firstChild);
      svg.appendChild(gOverview);

      // Build the zoomed 1T1C detail layer (hidden until a column is selected).
      buildDetail();

      // Container for the timing waveform strip (rebuilt each render).
      gWave = el("g", { id: "g-wave" });
      svg.appendChild(gWave);
    }

    // ---------- 1T1C detail schematic (images.png-style) ----------
    function buildDetail() {
      gDetail = el("g", { id: "g-detail" });
      gDetail.style.display = "none";

      const capTopY = D_WL + 34;

      // Title
      detail.title = el("text", {
        x: (D_BL + D_BLB) / 2,
        y: 44,
        class: "d-title",
        "text-anchor": "middle",
      });
      detail.title.textContent = "CELL · 1T1C";
      gDetail.appendChild(detail.title);

      // Bit-line labels
      const blLabel = el("text", {
        x: D_BL,
        y: D_TOP - 10,
        class: "d-axis",
        "text-anchor": "middle",
      });
      blLabel.textContent = "BL";
      gDetail.appendChild(blLabel);
      const blbLabel = el("text", {
        x: D_BLB,
        y: D_TOP - 10,
        class: "d-axis",
        "text-anchor": "middle",
      });
      blbLabel.textContent = "BL/";
      gDetail.appendChild(blbLabel);

      // Bit-line voltage-level annotations (Vdd/2, ↑/↓, Vdd, 0)
      detail.blV = el("text", {
        x: D_BL - 14,
        y: D_TOP + 20,
        class: "d-level",
        "text-anchor": "end",
      });
      gDetail.appendChild(detail.blV);
      detail.blbV = el("text", {
        x: D_BLB + 14,
        y: D_TOP + 20,
        class: "d-level",
        "text-anchor": "start",
      });
      gDetail.appendChild(detail.blbV);

      // Bit lines
      detail.bl = el("line", {
        x1: D_BL,
        y1: D_TOP,
        x2: D_BL,
        y2: D_SA_T,
        class: "d-bitline",
      });
      detail.blb = el("line", {
        x1: D_BLB,
        y1: D_TOP,
        x2: D_BLB,
        y2: D_SA_T,
        class: "d-bitline",
      });
      gDetail.appendChild(detail.bl);
      gDetail.appendChild(detail.blb);

      // Word line (horizontal) + label
      detail.wl = el("line", {
        x1: 250,
        y1: D_WL,
        x2: 470,
        y2: D_WL,
        class: "d-wordline",
      });
      gDetail.appendChild(detail.wl);
      const wlLabel = el("text", {
        x: 240,
        y: D_WL + 4,
        class: "d-axis",
        "text-anchor": "end",
      });
      wlLabel.textContent = "WL";
      gDetail.appendChild(wlLabel);

      // Access transistor — standard n-MOSFET symbol: WL drives the gate,
      // source ties to BL, drain to the cell capacitor (as in the refs).
      detail.trans = el("g", { class: "d-trans" });
      const gX = 400; // transistor center
      const gW = 13; // half-width of gate / channel
      const gateY = 142; // gate electrode
      const chanY = 148; // channel bar (top)
      const railY = capTopY; // source/drain routing height
      // gate stub from WL down to the gate electrode
      detail.trans.appendChild(
        el("line", { x1: gX, y1: D_WL, x2: gX, y2: gateY, class: "d-wire" }),
      );
      // gate electrode bar (driven by WL)
      detail.transGate = el("line", {
        x1: gX - gW,
        y1: gateY,
        x2: gX + gW,
        y2: gateY,
        class: "d-gate",
      });
      // channel / body (fills when the transistor turns on)
      detail.channel = el("rect", {
        x: gX - gW,
        y: chanY,
        width: gW * 2,
        height: 8,
        class: "d-channel",
      });
      detail.trans.appendChild(detail.channel);
      detail.trans.appendChild(detail.transGate);
      // source: down from channel, then across to BL
      detail.trans.appendChild(
        el("line", { x1: gX - gW, y1: chanY + 8, x2: gX - gW, y2: railY, class: "d-wire" }),
      );
      detail.trans.appendChild(
        el("line", { x1: gX - gW, y1: railY, x2: D_BL, y2: railY, class: "d-wire" }),
      );
      // drain: down from channel, then across to the capacitor
      detail.trans.appendChild(
        el("line", { x1: gX + gW, y1: chanY + 8, x2: gX + gW, y2: railY, class: "d-wire" }),
      );
      detail.trans.appendChild(
        el("line", { x1: gX + gW, y1: railY, x2: 420, y2: railY, class: "d-wire" }),
      );
      gDetail.appendChild(detail.trans);

      // Capacitor Cc + Vcp
      const capX = 452;
      detail.cap = el("g", { class: "d-cap" });
      detail.cap.appendChild(
        el("line", { x1: 420, y1: capTopY, x2: capX, y2: capTopY, class: "d-wire" }),
      );
      // top plate
      detail.cap.appendChild(
        el("line", {
          x1: capX,
          y1: capTopY - 12,
          x2: capX,
          y2: capTopY + 12,
          class: "d-plate",
        }),
      );
      // bottom plate (charge indicator)
      detail.capPlate = el("line", {
        x1: capX + 10,
        y1: capTopY - 12,
        x2: capX + 10,
        y2: capTopY + 12,
        class: "d-plate d-plate-charge",
      });
      detail.cap.appendChild(detail.capPlate);
      // to Vcp
      detail.cap.appendChild(
        el("line", {
          x1: capX + 10,
          y1: capTopY,
          x2: capX + 40,
          y2: capTopY,
          class: "d-wire",
        }),
      );
      const ccLabel = el("text", {
        x: capX + 5,
        y: capTopY - 20,
        class: "d-axis",
        "text-anchor": "middle",
      });
      ccLabel.textContent = "Cc";
      detail.cap.appendChild(ccLabel);
      const vcpLabel = el("text", {
        x: capX + 46,
        y: capTopY + 4,
        class: "d-axis",
        "text-anchor": "start",
      });
      vcpLabel.textContent = "Vcp";
      detail.cap.appendChild(vcpLabel);
      gDetail.appendChild(detail.cap);

      // Sense-amp box (cross-coupled latch, stylized)
      detail.saBox = el("rect", {
        x: 296,
        y: D_SA_T,
        width: D_BLB - D_BL + 200,
        height: D_SA_B - D_SA_T,
        rx: 4,
        class: "d-sa-box",
      });
      // recenter the box around the two bit lines
      detail.saBox.setAttribute("x", D_BL - 92);
      detail.saBox.setAttribute("width", D_BLB - D_BL + 184);
      gDetail.appendChild(detail.saBox);
      const saLabel = el("text", {
        x: D_BL - 92 + 8,
        y: D_SA_T + 18,
        class: "d-axis",
        "text-anchor": "start",
      });
      saLabel.textContent = "SA";
      gDetail.appendChild(saLabel);

      // SAP / SAN rails
      const midY = (D_SA_T + D_SA_B) / 2;
      const sapY = D_SA_T + 26;
      const sanY = D_SA_B - 26;
      ["SAP", "SAN"].forEach((nm, i) => {
        const y = i === 0 ? sapY : sanY;
        gDetail.appendChild(
          el("line", {
            x1: D_BL - 40,
            y1: y,
            x2: D_BLB + 40,
            y2: y,
            class: "d-rail",
          }),
        );
        const lbl = el("text", {
          x: (D_BL + D_BLB) / 2,
          y: i === 0 ? y - 6 : y + 14,
          class: "d-axis",
          "text-anchor": "middle",
        });
        lbl.textContent = nm;
        gDetail.appendChild(lbl);
      });

      // Cross-coupled inverter pair, drawn as two crossing links
      detail.sa = el("g", { class: "d-sa" });
      // BL node down into box, BL/ node down into box
      detail.sa.appendChild(
        el("line", { x1: D_BL, y1: D_SA_T, x2: D_BL, y2: sanY, class: "d-wire" }),
      );
      detail.sa.appendChild(
        el("line", { x1: D_BLB, y1: D_SA_T, x2: D_BLB, y2: sanY, class: "d-wire" }),
      );
      // cross links (clear X — the cross-coupled pair)
      const xh = 24;
      detail.sa.appendChild(
        el("line", {
          x1: D_BL,
          y1: midY - xh,
          x2: D_BLB,
          y2: midY + xh,
          class: "d-cross",
        }),
      );
      detail.sa.appendChild(
        el("line", {
          x1: D_BLB,
          y1: midY - xh,
          x2: D_BL,
          y2: midY + xh,
          class: "d-cross",
        }),
      );
      // transistor nodes (dots)
      [
        [D_BL, midY],
        [D_BLB, midY],
      ].forEach(([cx, cy]) => {
        detail.sa.appendChild(el("circle", { cx, cy, r: 3.5, class: "d-node" }));
      });
      gDetail.appendChild(detail.sa);

      // Data I/O arrow (abstract "data in / out") below the SA box
      detail.dataGroup = el("g", { class: "d-data" });
      detail.dataLine = el("line", {
        x1: D_BLB + 40,
        y1: D_SA_B + 24,
        x2: D_BLB + 150,
        y2: D_SA_B + 24,
        class: "d-data-line",
      });
      detail.dataArrow = el("polygon", {
        points: `${D_BLB + 150},${D_SA_B + 24} ${D_BLB + 140},${D_SA_B + 19} ${D_BLB + 140},${D_SA_B + 29}`,
        class: "d-data-arrow",
      });
      detail.dataLabel = el("text", {
        x: D_BLB + 40,
        y: D_SA_B + 14,
        class: "d-data-label",
        "text-anchor": "start",
      });
      detail.dataLabel.textContent = "DATA";
      // stub from SA box to the data line
      detail.dataGroup.appendChild(
        el("line", {
          x1: D_BLB,
          y1: D_SA_B,
          x2: D_BLB,
          y2: D_SA_B + 24,
          class: "d-data-line",
        }),
      );
      detail.dataGroup.appendChild(
        el("line", {
          x1: D_BLB,
          y1: D_SA_B + 24,
          x2: D_BLB + 40,
          y2: D_SA_B + 24,
          class: "d-data-line",
        }),
      );
      detail.dataGroup.appendChild(detail.dataLine);
      detail.dataGroup.appendChild(detail.dataArrow);
      detail.dataGroup.appendChild(detail.dataLabel);
      gDetail.appendChild(detail.dataGroup);

      svg.appendChild(gDetail);
    }

    // ---------- 1T1C detail render ----------
    function renderDetail(st) {
      // Title: ROW shown once resolved, COL appended once a column is selected.
      let title = "CELL · 1T1C";
      if (st.rowAddr && st.rowAddr !== "—") {
        title = `CELL · ROW ${st.rowAddr}`;
        if (st.colAddr && st.colAddr !== "—") title += ` / COL ${st.colAddr}`;
      }
      detail.title.textContent = title;

      const rowOpen = st.wordlines && st.wordlines.length > 0;
      const phase = st.cellPhase;
      const sharing = phase === "sharing";
      const writing = phase === "writing" || st.senseAmpPhase === "writing";
      const leaking = phase === "leak";
      // SA is developing once its phase is set (charge-sharing precedes that).
      const developed = st.senseAmpPhase && st.senseAmpPhase !== "idle";

      // Word line + transistor (on whenever the row is open)
      classSet(detail.wl, "on", rowOpen);
      classSet(detail.transGate, "on", rowOpen);
      classSet(detail.channel, "open", rowOpen);

      // Bit lines: small nudge during charge sharing, full rails once developed
      detail.bl.className.baseVal =
        "d-bitline" + (developed ? " on" : sharing ? " nudge" : "");
      detail.blb.className.baseVal = "d-bitline" + (developed ? " on" : "");

      // Bit-line voltage annotations
      let blv = "",
        blbv = "";
      if (sharing) {
        blv = "Vdd/2 ↑";
        blbv = "Vdd/2";
      } else if (!writing && developed) {
        blv = "Vdd";
        blbv = "0";
      }
      detail.blV.textContent = blv;
      detail.blbV.textContent = blbv;
      classSet(detail.blV, "up", sharing);

      // Capacitor charge: sharing/amplify = partly drained, restore/held = full
      detail.capPlate.className.baseVal = "d-plate d-plate-charge";
      if (writing) detail.capPlate.classList.add("writing");
      else if (leaking) detail.capPlate.classList.add("leak");
      else if (sharing || phase === "sensed")
        detail.capPlate.classList.add("shared");
      else if (rowOpen || phase === "restore" || phase === "refresh")
        detail.capPlate.classList.add("charged");

      // Sense amp box active once developing
      classSet(detail.saBox, "on", developed);
      detail.sa.className.baseVal = "d-sa" + (developed ? " on" : "");
      if (writing) detail.sa.classList.add("writing");

      // Data arrow: out on read burst, in on write
      const dg = detail.dataGroup;
      dg.className.baseVal = "d-data";
      if (st.dqPhase === "burst") dg.classList.add("out");
      else if (st.dqPhase === "incoming") dg.classList.add("in");
      detail.dataLabel.textContent =
        st.dqPhase === "incoming" ? "DATA IN" : "DATA OUT";
      // Arrowhead points toward the cell for incoming, outward for outgoing.
      const ay = D_SA_B + 24;
      if (st.dqPhase === "incoming") {
        detail.dataArrow.setAttribute(
          "points",
          `${D_BLB + 44},${ay} ${D_BLB + 56},${ay - 5} ${D_BLB + 56},${ay + 5}`,
        );
      } else {
        detail.dataArrow.setAttribute(
          "points",
          `${D_BLB + 150},${ay} ${D_BLB + 140},${ay - 5} ${D_BLB + 140},${ay + 5}`,
        );
      }
    }

    // ---------- Timing waveform render ----------
    function renderWave(scn, st) {
      const w = scn.wave;
      gWave.innerHTML = "";
      if (!w) return;

      const line = (x1, y1, x2, y2, cls) =>
        gWave.appendChild(el("line", { x1, y1, x2, y2, class: cls || "wave-level" }));
      const text = (x, y, cls, anchor, str) => {
        const t = el("text", { x, y, class: cls, "text-anchor": anchor });
        t.textContent = str;
        gWave.appendChild(t);
        return t;
      };

      const px = waveX(w.pos[S.step] != null ? w.pos[S.step] : 0);
      // which phase is the playhead in (for label highlight)?
      const curPhase = SENSE.phases.findIndex(
        (p) => w.pos[S.step] >= p.x0 && w.pos[S.step] < p.x1,
      );

      // ---- progress shade up to the playhead ----
      gWave.appendChild(
        el("rect", {
          x: WAVE_X0,
          y: G_VCCVT - 10,
          width: Math.max(0, px - WAVE_X0),
          height: G_GND - G_VCCVT + 20,
          class: "wave-past",
        }),
      );

      // ---- voltage level lines + left labels ----
      SENSE.levels.forEach((lv) => {
        line(
          WAVE_X0,
          lv.y,
          WAVE_X1,
          lv.y,
          "wave-level" + (lv.dash ? " dash" : ""),
        );
        text(WAVE_X0 - 12, lv.y + 4, "wave-level-label", "end", lv.label);
      });

      // ---- curves ----
      SENSE.curves.forEach((cv) => {
        let d = "";
        cv.a.forEach((pt, i) => {
          const x = waveX(pt[0]);
          const y = gLevel[pt[1]];
          if (i === 0) {
            d = `M ${x} ${y}`;
            return;
          }
          const pprev = cv.a[i - 1];
          const pxc = waveX(pprev[0]);
          const pyc = gLevel[pprev[1]];
          if (Math.abs(pyc - y) < 0.5) {
            d += ` L ${x.toFixed(1)} ${y}`;
          } else {
            const dx = (x - pxc) * 0.4;
            d += ` C ${(pxc + dx).toFixed(1)} ${pyc} ${(x - dx).toFixed(1)} ${y} ${x.toFixed(1)} ${y}`;
          }
        });
        gWave.appendChild(
          el("path", { d, class: "wave-curve " + cv.cls + (cv.dash ? " dash" : "") }),
        );
        text(waveX(cv.lx), cv.ly, "wave-curve-label " + cv.cls, "middle", cv.label);
      });

      // ---- phase circles on the Vref line ----
      SENSE.circles.forEach((c) => {
        const x = waveX(c.x);
        gWave.appendChild(
          el("circle", { cx: x, cy: G_VREF, r: 9, class: "wave-phase-circle" }),
        );
        text(x, G_VREF + 4, "wave-phase-num", "middle", String(c.n));
      });

      // ---- playhead ----
      gWave.appendChild(
        el("line", {
          x1: px,
          y1: G_VCCVT - 10,
          x2: px,
          y2: G_GND + 4,
          class: "wave-playhead",
        }),
      );

      // ---- phase arrows + labels below Gnd ----
      SENSE.phases.forEach((p, i) => {
        const x0 = waveX(p.x0) + 6;
        const x1 = waveX(p.x1) - 6;
        const on = i === curPhase;
        const cls = "wave-phase-arrow" + (on ? " hi" : "");
        line(x0, G_PHASE, x1 - 6, G_PHASE, cls);
        gWave.appendChild(
          el("polygon", {
            points: `${x1},${G_PHASE} ${x1 - 7},${G_PHASE - 4} ${x1 - 7},${G_PHASE + 4}`,
            class: "wave-phase-head" + (on ? " hi" : ""),
          }),
        );
        text(
          (x0 + x1) / 2,
          G_PHASE + 15,
          "wave-phase-label" + (on ? " hi" : ""),
          "middle",
          p.name,
        );
      });

      // ---- tRCD / tRAS / tRP brackets ----
      SENSE.brackets.forEach((b) => {
        const y = b.row === 1 ? G_BRK2 : G_BRK1;
        const x0 = waveX(b.x0);
        const x1 = waveX(b.x1);
        const on = st.highlightTiming === b.key;
        const cls = "wave-brk" + (on ? " hi" : "");
        line(x0, y, x1, y, cls);
        line(x0, y - 4, x0, y, cls);
        line(x1, y - 4, x1, y, cls);
        text(
          (x0 + x1) / 2,
          y + 12,
          "wave-brk-label" + (on ? " hi" : ""),
          "middle",
          b.label,
        );
      });
    }

    // ---------- Rendering ----------
    function classSet(el, cls, on) {
      if (on) el.classList.add(cls);
      else el.classList.remove(cls);
    }

    // Wrap known technical terms inside a DOM subtree with hoverable spans.
    const TERM_KEYS = Object.keys(TERM_DEFS).sort(
      (a, b) => b.length - a.length,
    );
    const TERM_REGEX = new RegExp(
      "(?:^|[\\s(\\[/,.;:])((?:" +
        TERM_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
          "|",
        ) +
        "))(?=$|[\\s)\\],.;:/])",
      "g",
    );
    function wrapTermsInNode(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          // Skip nodes already inside a .term span
          let p = n.parentNode;
          while (p && p !== root) {
            if (p.classList && p.classList.contains("term"))
              return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const text = node.nodeValue;
        TERM_REGEX.lastIndex = 0;
        if (!TERM_REGEX.test(text)) return;
        TERM_REGEX.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = TERM_REGEX.exec(text)) !== null) {
          const term = m[1];
          const start = m.index + (m[0].length - term.length);
          if (start > last)
            frag.appendChild(document.createTextNode(text.slice(last, start)));
          const span = document.createElement("span");
          span.className = "term";
          span.tabIndex = 0;
          span.dataset.term = term;
          span.textContent = term;
          frag.appendChild(span);
          last = start + term.length;
          // Ensure regex advances past the term
          TERM_REGEX.lastIndex = last;
        }
        if (last < text.length)
          frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    }

    function render() {
      const scn = scenarios[S.scenario];
      const step = scn.steps[S.step];
      const st = step.state;

      // Root scenario + language for CSS accent variable. Set data-scn on
      // the root too so the floating tooltip (a sibling of .app) picks up
      // the scenario accent instead of the default READ color.
      const app = document.querySelector(".app");
      app.setAttribute("data-scn", S.scenario);
      app.setAttribute("data-lang", S.lang);
      document.documentElement.setAttribute("data-scn", S.scenario);
      document.documentElement.lang = S.lang;

      // Dismiss any lingering tooltip: navigating rebuilds the step DOM and
      // destroys the hovered element without firing mouseout, which would
      // otherwise leave the tooltip stuck on screen covering the text.
      const tip = document.getElementById("tooltip");
      if (tip) {
        tip.classList.remove("visible");
        tip.setAttribute("aria-hidden", "true");
      }

      // Language toggle button state
      document.querySelectorAll(".lang-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.lang === S.lang);
      });

      // Static UI strings
      document.getElementById("brand-sub").textContent = t(UI.brandSub);
      document.getElementById("meta-array-label").textContent = t(UI.metaArray);
      document.getElementById("meta-profile-label").textContent = t(
        UI.metaProfile,
      );
      document.getElementById("stage-label").textContent = t(UI.stageLabel);
      document.getElementById("legend-idle").textContent = t(UI.legendIdle);
      document.getElementById("legend-wl").textContent = t(UI.legendWl);
      document.getElementById("legend-sa").textContent = t(UI.legendSa);
      document.getElementById("legend-dq").textContent = t(UI.legendDq);
      document.getElementById("panel-step").textContent = t(UI.panelStep);
      document.getElementById("panel-command").textContent = t(UI.panelCommand);
      document.getElementById("panel-timing").textContent = t(UI.panelTiming);
      document.getElementById("btn-reset").textContent = t(UI.btnReset);
      document.getElementById("btn-prev").textContent = t(UI.btnPrev);
      document.getElementById("btn-next").textContent = t(UI.btnNext);

      // SVG labels
      const setSvg = (id, val) => {
        const e = document.getElementById(id);
        if (e) e.textContent = val;
      };
      setSvg("svg-cell-array-label", t(UI.svgCellArray));
      setSvg("svg-sense-amps-label", t(UI.svgSenseAmps));
      setSvg("svg-dq-bus-label", t(UI.svgDqBus));
      setSvg("svg-dq-out-label", t(UI.svgDqOut));
      setSvg("svg-row-dec-label", t(UI.svgRowDec));
      setSvg("svg-col-dec-label", t(UI.svgColDec));

      // Tab labels
      document.getElementById("tab-read").textContent = t(scenarios.read.label);
      document.getElementById("tab-write").textContent = t(
        scenarios.write.label,
      );

      // Tabs active
      document.querySelectorAll(".tab").forEach((tabEl) => {
        tabEl.classList.toggle("active", tabEl.dataset.scenario === S.scenario);
      });

      // Header op
      document.getElementById("current-op").textContent = t(step.op);

      // Step panel
      document.getElementById("step-num").textContent = String(
        S.step + 1,
      ).padStart(2, "0");
      document.getElementById("step-total").textContent = String(
        scn.steps.length,
      ).padStart(2, "0");
      document.getElementById("step-op").textContent = t(step.op);
      document.getElementById("step-title").textContent = t(step.title);
      const descEl = document.getElementById("step-desc");
      descEl.innerHTML = t(step.desc);
      wrapTermsInNode(descEl);

      // Command bus — wrap chips as hoverable terms too
      const cbEl = document.getElementById("command-list");
      cbEl.innerHTML = "";
      st.bus.forEach((cmd, i) => {
        const chip = document.createElement("span");
        chip.className =
          "cmd-chip" + (i === st.bus.length - 1 ? " current" : "");
        chip.textContent = cmd;
        if (TERM_DEFS[cmd]) {
          chip.classList.add("term");
          chip.dataset.term = cmd;
          chip.tabIndex = 0;
        }
        cbEl.appendChild(chip);
      });

      // Timing panel
      const tp = document.getElementById("timing-list");
      tp.innerHTML = "";
      document.getElementById("timing-profile").textContent = t(scn.profile);
      scn.timings.forEach((row) => {
        const isHi = st.highlightTiming === row.key;
        const dt = document.createElement("dt");
        dt.textContent = row.name;
        const termKey = row.termKey || row.name;
        if (TERM_DEFS[termKey]) {
          dt.classList.add("term");
          dt.dataset.term = termKey;
          dt.tabIndex = 0;
        }
        const dd = document.createElement("dd");
        dd.textContent = t(row.value);
        if (row.valueKey && TERM_DEFS[row.valueKey]) {
          dd.classList.add("term");
          dd.dataset.term = row.valueKey;
          dd.tabIndex = 0;
        }
        const d = document.createElement("span");
        d.className = "desc";
        d.textContent = t(row.desc);
        if (isHi) {
          dt.classList.add("hi");
          dd.classList.add("hi");
          d.classList.add("hi");
        }
        tp.appendChild(dt);
        tp.appendChild(d);
        tp.appendChild(dd);
      });

      // Footer counters
      document.getElementById("sc-cur").textContent = String(
        S.step + 1,
      ).padStart(2, "0");
      document.getElementById("sc-tot").textContent = String(
        scn.steps.length,
      ).padStart(2, "0");
      document.getElementById("progress-fill").style.width =
        `${((S.step + 1) / scn.steps.length) * 100}%`;

      // Buttons
      document.getElementById("btn-prev").disabled = S.step === 0;
      document.getElementById("btn-next").disabled =
        S.step === scn.steps.length - 1;
      document.getElementById("btn-play").textContent = S.playing
        ? t(UI.btnPause)
        : t(UI.btnPlay);

      // Decoder values
      rowDecValue.textContent = st.rowAddr || "—";
      colDecValue.textContent = st.colAddr || "—";
      classSet(rowDecEl, "on", st.rowAddr && st.rowAddr !== "—");
      classSet(rowDecValue, "on", st.rowAddr && st.rowAddr !== "—");
      classSet(colDecEl, "on", st.colAddr && st.colAddr !== "—");
      classSet(colDecValue, "on", st.colAddr && st.colAddr !== "—");

      // Word lines
      const wlSet = new Set(st.wordlines);
      for (let r = 0; r < NUM_ROWS; r++) {
        classSet(wlEls[r], "on", wlSet.has(r));
      }

      // Bit lines
      const blOn = st.bitlines === "all";
      for (let c = 0; c < NUM_COLS; c++) {
        classSet(blEls[c], "on", blOn);
        classSet(blEls[c], "hit", st.hitCol === c);
      }

      // Cells
      for (let r = 0; r < NUM_ROWS; r++) {
        for (let c = 0; c < NUM_COLS; c++) {
          const g = cellEls[r][c];
          g.className.baseVal = "cell";
          const rowActive = wlSet.has(r);
          const hit = st.hitCol === c && rowActive;
          if (hit && st.cellPhase === "writing") {
            g.classList.add("writing");
          } else if (
            hit &&
            (st.cellPhase === "sensed" || st.cellPhase === "sharing")
          ) {
            g.classList.add("hit");
          } else if (rowActive) {
            if (st.cellPhase === "sharing") g.classList.add("sharing");
            else if (st.cellPhase === "sensed" || st.cellPhase === "restore")
              g.classList.add("sensed");
            else if (st.cellPhase === "writing") g.classList.add("writing");
            else if (st.cellPhase === "refresh") g.classList.add("refresh");
            else g.classList.add("wl");
          }
        }
      }

      // Sense amps
      for (let c = 0; c < NUM_COLS; c++) {
        const sa = saEls[c];
        sa.className.baseVal = "sa";
        if (st.senseAmpPhase === "writing" && st.hitCol === c)
          sa.classList.add("writing");
        else if (st.senseAmpPhase === "reading" && st.hitCol === c)
          sa.classList.add("hit");
        else if (st.senseAmpPhase === "latched") sa.classList.add("latched");
        else if (st.senseAmpPhase === "writing") sa.classList.add("latched");
        else if (st.senseAmpPhase === "reading") sa.classList.add("latched");
      }

      // DQ
      const dqOn = st.dqPhase && st.dqPhase !== "idle";
      classSet(dqBusEl, "on", dqOn);
      classSet(document.getElementById("dq-out"), "on", dqOn);
      classSet(dqLabelEl, "on", dqOn);
      dqParticleEl.forEach((p) => {
        p.classList.remove("flowing", "write");
        if (st.dqPhase === "burst") p.classList.add("flowing");
        else if (st.dqPhase === "incoming") {
          p.classList.add("flowing", "write");
          // reset origin for reversed flow (start from right)
          p.setAttribute(
            "cx",
            GRID_X + GRID_W - 4 - dqParticleEl.indexOf(p) * 18,
          );
        } else if (st.dqPhase === "route") p.classList.add("flowing");
      });
      // Ensure normal-flow particles start from left
      if (st.dqPhase === "burst" || st.dqPhase === "route") {
        dqParticleEl.forEach((p, i) =>
          p.setAttribute("cx", GRID_X - 4 + i * 18),
        );
      }

      // Detail (zoomed 1T1C) vs. array-overview layer.
      // Once a column is resolved we switch to the single-cell schematic.
      const showDetail =
        st.view === "detail" || (st.colAddr && st.colAddr !== "—");
      gOverview.style.display = showDetail ? "none" : "";
      gDetail.style.display = showDetail ? "" : "none";
      if (showDetail) renderDetail(st);

      // Timing waveform strip (always visible).
      renderWave(scn, st);
    }

    // ---------- Controls ----------
    function goto(step) {
      const scn = scenarios[S.scenario];
      S.step = Math.max(0, Math.min(scn.steps.length - 1, step));
      if (S.step === scn.steps.length - 1) pause();
      render();
    }

    function next() {
      goto(S.step + 1);
    }
    function prev() {
      goto(S.step - 1);
    }
    function reset() {
      pause();
      goto(0);
    }

    function play() {
      if (S.playing) return;
      const scn = scenarios[S.scenario];
      if (S.step >= scn.steps.length - 1) goto(0);
      S.playing = true;
      render();
      S.timer = setInterval(() => {
        const scn = scenarios[S.scenario];
        if (S.step >= scn.steps.length - 1) {
          pause();
          return;
        }
        goto(S.step + 1);
      }, 2200);
    }
    function pause() {
      S.playing = false;
      if (S.timer) {
        clearInterval(S.timer);
        S.timer = null;
      }
      render();
    }
    function togglePlay() {
      S.playing ? pause() : play();
    }

    function switchScenario(name) {
      if (!scenarios[name]) return;
      pause();
      S.scenario = name;
      S.step = 0;
      render();
    }

    function setLanguage(lang) {
      if (lang !== "en" && lang !== "ko") return;
      if (S.lang === lang) return;
      S.lang = lang;
      try {
        localStorage.setItem("dram-lang", lang);
      } catch (_) {}
      render();
    }

    function applyTheme() {
      const light = S.theme === "light";
      document.documentElement.setAttribute("data-theme", S.theme);
      const icon = document.getElementById("theme-icon");
      // Show the theme you'll switch TO: sun in dark mode, moon in light mode.
      if (icon) icon.textContent = light ? "☾" : "☀";
      const btn = document.getElementById("theme-toggle");
      if (btn) btn.setAttribute("aria-pressed", String(light));
    }

    function setTheme(theme) {
      if (theme !== "light" && theme !== "dark") return;
      S.theme = theme;
      try {
        localStorage.setItem("dram-theme", theme);
      } catch (_) {}
      applyTheme();
    }

    // ---------- Tooltip for technical terms ----------
    function setupTooltip() {
      const tip = document.getElementById("tooltip");
      if (!tip) return;
      let hideTimer = null;

      function show(target) {
        const key = target.dataset.term;
        const def = TERM_DEFS[key];
        if (!def) return;
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        tip.innerHTML = "";
        const name = document.createElement("span");
        name.className = "tt-name";
        name.textContent = def.name || key;
        const body = document.createElement("span");
        body.className = "tt-body";
        body.textContent = def[S.lang] || def.en;
        tip.appendChild(name);
        tip.appendChild(body);
        // Position after content is set so we know its size
        tip.classList.add("visible");
        tip.setAttribute("aria-hidden", "false");
        position(target);
      }

      function position(target) {
        const r = target.getBoundingClientRect();
        const tr = tip.getBoundingClientRect();
        const margin = 8;
        let left = r.left + r.width / 2 - tr.width / 2;
        let top = r.bottom + margin;
        // Flip above if overflowing viewport bottom
        if (top + tr.height > window.innerHeight - 8) {
          top = r.top - tr.height - margin;
        }
        // Clamp horizontally
        left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, left));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }

      function hide() {
        hideTimer = setTimeout(() => {
          tip.classList.remove("visible");
          tip.setAttribute("aria-hidden", "true");
        }, 60);
      }

      // Event delegation — works for terms rendered later too
      document.addEventListener("mouseover", (e) => {
        const target = e.target.closest && e.target.closest(".term");
        if (target) show(target);
      });
      document.addEventListener("mouseout", (e) => {
        const target = e.target.closest && e.target.closest(".term");
        if (target) hide();
      });
      document.addEventListener("focusin", (e) => {
        const target = e.target.closest && e.target.closest(".term");
        if (target) show(target);
      });
      document.addEventListener("focusout", (e) => {
        const target = e.target.closest && e.target.closest(".term");
        if (target) hide();
      });
      // Dismiss on scroll
      window.addEventListener(
        "scroll",
        () => {
          tip.classList.remove("visible");
        },
        true,
      );
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") tip.classList.remove("visible");
      });
    }

    // ---------- Wire up ----------
    function init() {
      buildSVG();

      document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () =>
          switchScenario(tab.dataset.scenario),
        );
      });
      document.querySelectorAll(".lang-btn").forEach((btn) => {
        btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
      });
      document
        .getElementById("theme-toggle")
        .addEventListener("click", () =>
          setTheme(S.theme === "light" ? "dark" : "light"),
        );
      document.getElementById("btn-reset").addEventListener("click", reset);
      document.getElementById("btn-prev").addEventListener("click", prev);
      document.getElementById("btn-next").addEventListener("click", next);
      document.getElementById("btn-play").addEventListener("click", togglePlay);

      document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
          return;
        switch (e.key) {
          case "ArrowRight":
          case "l":
            next();
            break;
          case "ArrowLeft":
          case "h":
            prev();
            break;
          case " ":
            e.preventDefault();
            togglePlay();
            break;
          case "r":
          case "R":
            reset();
            break;
          case "1":
            switchScenario("read");
            break;
          case "2":
            switchScenario("write");
            break;
          case "k":
          case "K":
            setLanguage(S.lang === "en" ? "ko" : "en");
            break;
          case "t":
          case "T":
            setTheme(S.theme === "light" ? "dark" : "light");
            break;
        }
      });

      applyTheme();
      setupTooltip();
      render();
    }

    init();
  })();
