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
              en: "Bank is in the precharged state — every bit line is held at <code>Vdd/2</code> by the precharge equalisers, and no word line is asserted. The row buffer is empty; no column can be accessed until a row is opened.",
              ko: "Bank가 precharge 상태입니다 — 모든 bit line이 precharge equalizer에 의해 <code>Vdd/2</code>로 유지되며, 어떤 word line도 활성화되어 있지 않습니다. Row buffer는 비어 있고, row가 열리기 전까지는 어떤 column도 접근할 수 없습니다.",
            },
            state: { ...IDLE_STATE },
          },
          {
            op: { en: "ACT · row 0x3", ko: "ACT · row 0x3" },
            title: { en: "ACT — Row Activate", ko: "ACT — row 활성화" },
            desc: {
              en: "Controller drives <code>ACTIVATE</code> on the command bus with a bank + row address. Word line <code>0x3</code> rises to the boosted voltage <code>Vpp</code>; every access transistor in row 3 turns on.",
              ko: "컨트롤러가 명령 버스에 bank + row 주소와 함께 <code>ACTIVATE</code>를 인가합니다. Word line <code>0x3</code>이 부스트 전압 <code>Vpp</code>까지 올라가며, row 3의 모든 access transistor가 켜집니다.",
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
            op: { en: "ACT · charge sharing", ko: "ACT · 전하 공유" },
            title: { en: "Charge Sharing", ko: "전하 공유" },
            desc: {
              en: "Each cell capacitor (~25 fF) shares its charge with the much larger bit-line capacitance. Every bit line drifts a few tens of millivolts above or below <code>Vdd/2</code> — the direction encodes the stored bit for that column.",
              ko: "각 셀 capacitor(~25 fF)가 훨씬 큰 bit line capacitance와 전하를 공유합니다. 모든 bit line이 <code>Vdd/2</code> 위 또는 아래로 수십 밀리볼트 정도 움직이며 — 그 방향이 해당 column에 저장된 비트를 나타냅니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              cellPhase: "sharing",
              rowAddr: "0x3",
              bus: ["ACT"],
            },
          },
          {
            op: { en: "SENSE / RESTORE", ko: "센싱 / 복원" },
            title: { en: "Sense & Restore", ko: "센싱 및 복원" },
            desc: {
              en: "Sense amplifiers detect the differential, latch it, and drive each bit line to full rail (<code>0</code> or <code>Vdd</code>). Because word line 3 is still asserted, the same drive restores full charge into every cell of the row — the row buffer is now valid. Interval from ACT to this point is <code>tRCD</code>.",
              ko: "Sense amp가 차동 신호를 감지하고 래치한 뒤, 각 bit line을 완전한 레벨(<code>0</code> 또는 <code>Vdd</code>)로 구동합니다. Word line 3이 여전히 활성 상태이므로 동일한 구동이 row의 모든 셀에 전하를 복원합니다 — 이제 row buffer가 유효합니다. ACT부터 이 지점까지의 간격이 <code>tRCD</code>입니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              cellPhase: "sensed",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              bus: ["ACT"],
              highlightTiming: "tRCD",
            },
          },
          {
            op: { en: "RD · col 0x6", ko: "RD · column 0x6" },
            title: { en: "RD — Column Select", ko: "RD — column 선택" },
            desc: {
              en: "Controller issues <code>READ</code> with column address <code>0x6</code>. The column decoder selects column 6 from the row buffer and routes it to the internal read data path. External DQ pins remain idle — data only appears after <code>CL</code> cycles elapse.",
              ko: "컨트롤러가 column 주소 <code>0x6</code>과 함께 <code>READ</code>를 발행합니다. Column decoder가 row buffer에서 column 6을 선택해 내부 read 데이터 경로로 전달합니다. 외부 DQ 핀은 아직 idle 상태 — <code>CL</code> 사이클이 지난 뒤에야 데이터가 실립니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "sensed",
              senseAmpPhase: "reading",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "RD"],
            },
          },
          {
            op: { en: "CL · DQ burst", ko: "CL · DQ burst" },
            title: { en: "CAS Latency → DQ Burst", ko: "CAS 지연 → DQ burst" },
            desc: {
              en: "After CAS latency (<code>CL</code> clock cycles from the RD command), the burst begins on the DQ pins — data captured on both clock edges. DDR4 uses <code>BL8</code>: eight beats over four clock cycles.",
              ko: "CAS 지연(RD 명령부터 <code>CL</code> 클록 사이클) 후에 DQ 핀에 burst가 시작됩니다 — 클록의 상승/하강 엣지 모두에서 데이터가 캡처됩니다. DDR4는 <code>BL8</code>을 사용 — 4 클록 사이클 동안 8 비트.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "sensed",
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
              en: "<code>PRECHARGE</code> closes the row. Word line 3 drops, then the equalisers pull bit lines back to <code>Vdd/2</code>. After <code>tRP</code> the bank is ready for another ACT — to the same or a different row.",
              ko: "<code>PRECHARGE</code>가 row를 닫습니다. Word line 3이 떨어진 뒤, equalizer가 bit line을 다시 <code>Vdd/2</code>로 되돌립니다. <code>tRP</code>가 지나면 bank는 동일한 또는 다른 row에 대한 새 ACT를 받을 준비가 됩니다.",
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
        ],
        steps: [
          {
            op: { en: "IDLE", ko: "유휴" },
            title: { en: "Precharged / Idle", ko: "Precharge 상태 / 유휴" },
            desc: {
              en: "Bank precharged. Bit lines at <code>Vdd/2</code>, no word line asserted. Any write must first open the target row — DRAM has no per-cell write path independent of the row buffer.",
              ko: "Bank가 precharge된 상태입니다. Bit line은 <code>Vdd/2</code>에 있고, 활성화된 word line은 없습니다. 쓰기를 위해서는 먼저 대상 row를 열어야 합니다 — DRAM은 row buffer와 독립적인 셀 단위 쓰기 경로가 없습니다.",
            },
            state: { ...IDLE_STATE },
          },
          {
            op: { en: "ACT · row 0x3", ko: "ACT · row 0x3" },
            title: { en: "ACT — Row Activate", ko: "ACT — row 활성화" },
            desc: {
              en: "Controller issues <code>ACTIVATE</code> with row <code>0x3</code>. Word line 3 rises; every access transistor in the row turns on. Identical to the read path — DRAM does not distinguish read vs. write during activation.",
              ko: "컨트롤러가 row <code>0x3</code>과 함께 <code>ACTIVATE</code>를 발행합니다. Word line 3이 올라가고, 해당 row의 모든 access transistor가 켜집니다. 읽기 경로와 동일합니다 — DRAM은 활성화 단계에서 읽기와 쓰기를 구분하지 않습니다.",
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
            op: { en: "ACT · sense / restore", ko: "ACT · 센싱 / 복원" },
            title: { en: "Row Buffer Populated", ko: "Row buffer 로드 완료" },
            desc: {
              en: "Charge sharing followed by sense amplification — same physics as a read. The entire row is now latched in the sense amps. Only after this can a column be modified.",
              ko: "전하 공유 후 센스 증폭 — 읽기와 동일한 물리 과정입니다. 이제 전체 row가 sense amp에 래치되어 있습니다. 이 단계 이후에만 column을 수정할 수 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              cellPhase: "sensed",
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
              en: "Controller issues <code>WRITE</code> with column address <code>0x6</code>. The column decoder targets column 6 in the row buffer, but external DQ pins remain idle — the controller waits <code>CWL</code> cycles before driving data.",
              ko: "컨트롤러가 column 주소 <code>0x6</code>과 함께 <code>WRITE</code>를 발행합니다. Column decoder가 row buffer의 column 6을 지정하지만, 외부 DQ 핀은 아직 idle — 컨트롤러는 <code>CWL</code> 사이클을 기다린 뒤에 데이터를 실어 보냅니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "sensed",
              senseAmpPhase: "latched",
              rowAddr: "0x3",
              colAddr: "0x6",
              bus: ["ACT", "WR"],
            },
          },
          {
            op: { en: "CWL · DQ burst", ko: "CWL · DQ burst" },
            title: {
              en: "CAS Write Latency → DQ Burst",
              ko: "CAS Write Latency → DQ burst",
            },
            desc: {
              en: "After Write Latency (<code>CWL</code> cycles from the WR command), the controller drives the burst onto DQ. The write drivers overpower sense-amp column 6, forcing each incoming bit into the row buffer. DDR4 uses <code>BL8</code>: eight beats over four clock cycles.",
              ko: "Write Latency(WR 명령부터 <code>CWL</code> 사이클) 후에 컨트롤러가 DQ에 burst를 실어 보냅니다. Write driver가 column 6의 sense amp를 압도하며 들어오는 각 비트를 row buffer에 강제로 씁니다. DDR4는 <code>BL8</code>을 사용 — 4 클록 사이클 동안 8 비트.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "sensed",
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
              en: "The burst has completed and DQ is idle again. Because word line 3 is still asserted, the overwritten sense-amp value flows back through the still-open access transistor and charges (or discharges) the target cell capacitor to its new value.",
              ko: "Burst가 끝나 DQ는 다시 idle 상태입니다. Word line 3이 여전히 활성 상태이기 때문에, 덮어쓴 sense amp 값이 여전히 열린 access transistor를 통해 다시 흘러 대상 셀 capacitor를 새 값으로 충전(또는 방전)합니다.",
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
              en: "After the last write beat, the DRAM needs <code>tWR</code> (≈15 ns typical) to fully charge the cell before the row can be closed. Issuing PRE too early risks an incomplete write and lost data.",
              ko: "마지막 쓰기 비트 이후, DRAM은 row를 닫기 전에 셀을 완전히 충전하기 위해 <code>tWR</code>(일반적으로 ≈15 ns)이 필요합니다. PRE를 너무 일찍 발행하면 불완전한 쓰기와 데이터 손실 위험이 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [TARGET_ROW],
              bitlines: "all",
              hitCol: TARGET_COL,
              cellPhase: "sensed",
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
              en: "<code>PRECHARGE</code> closes the row. Word line 3 drops, then bit lines are equalised back to <code>Vdd/2</code>. After <code>tRP</code> the bank is available for another ACT.",
              ko: "<code>PRECHARGE</code>가 row를 닫습니다. Word line 3이 떨어진 뒤, bit line이 <code>Vdd/2</code>로 equalize됩니다. <code>tRP</code>가 지나면 bank에 새로운 ACT를 발행할 수 있습니다.",
            },
            state: {
              ...IDLE_STATE,
              bus: ["ACT", "WR", "PRE"],
              highlightTiming: "tRP",
            },
          },
        ],
      },

      refresh: {
        label: { en: "REFRESH", ko: "REFRESH" },
        color: "refresh",
        profile: {
          en: "DDR4 · Auto-Refresh (JEDEC)",
          ko: "DDR4 · Auto-Refresh (JEDEC)",
        },
        timings: [
          {
            name: "tREFI",
            value: { en: "7.8 μs", ko: "7.8 μs" },
            desc: { en: "avg REF interval", ko: "평균 REF 간격" },
            key: "tREFI",
          },
          {
            name: "tREFW",
            value: { en: "64 ms", ko: "64 ms" },
            desc: { en: "retention window", ko: "유지 시간" },
            key: "tREFW",
          },
          {
            name: "tRFC",
            value: { en: "~350 ns · ~560 cyc", ko: "~350 ns · ~560 cyc" },
            desc: { en: "REF cycle time", ko: "REF 사이클 시간" },
            key: "tRFC",
          },
          {
            name: "REF/W",
            value: { en: "8192", ko: "8192" },
            desc: { en: "REFs per window", ko: "윈도우당 REF 수" },
            key: null,
            valueKey: "REF/W",
          },
          {
            name: "tRP",
            value: { en: "22 cyc · 13.75 ns", ko: "22 cyc · 13.75 ns" },
            desc: { en: "internal PRE", ko: "내부 PRE" },
            key: null,
          },
        ],
        steps: [
          {
            op: { en: "IDLE · all banks PRE", ko: "유휴 · 모든 bank PRE" },
            title: { en: "All Banks Precharged", ko: "모든 bank Precharge" },
            desc: {
              en: "<code>REF</code> requires every bank to be precharged — nothing may be open. The DRAM maintains an internal refresh counter that names the next row group to refresh; the controller never supplies a row address.",
              ko: "<code>REF</code>는 모든 bank가 precharge되어 있어야 합니다 — 열려 있는 row가 없어야 합니다. DRAM은 다음에 refresh할 row 그룹을 가리키는 내부 refresh 카운터를 유지하며, 컨트롤러는 row 주소를 제공하지 않습니다.",
            },
            state: { ...IDLE_STATE },
          },
          {
            op: { en: "tREFI · REF due", ko: "tREFI · REF 시점" },
            title: { en: "Refresh Interval Elapsed", ko: "Refresh 간격 도달" },
            desc: {
              en: "On average every <code>tREFI</code> the controller must issue a REF. Cells only hold charge for the retention window <code>tREFW</code>, so the required REF count per window = tREFW / tREFI. DDR4 uses 64 ms / 7.8 μs ≈ 8192 REFs per window — enough to cover every row exactly once.",
              ko: "평균적으로 <code>tREFI</code>마다 컨트롤러는 REF를 발행해야 합니다. 셀은 유지 시간(<code>tREFW</code>) 동안만 전하를 유지하므로, window당 필요한 REF 횟수 = tREFW / tREFI. DDR4 기준 64 ms / 7.8 μs ≈ 8192번의 REF가 window 안에서 모든 row를 정확히 한 번씩 커버합니다.",
            },
            state: { ...IDLE_STATE, highlightTiming: "tREFI" },
          },
          {
            op: { en: "REF", ko: "REF" },
            title: {
              en: "REF — Auto-Refresh Command",
              ko: "REF — 자동 Refresh 명령",
            },
            desc: {
              en: "Controller drives <code>REFRESH</code> on the command bus. No row address accompanies it — the DRAM alone decides which rows to refresh next, using its internal counter.",
              ko: "컨트롤러가 명령 버스에 <code>REFRESH</code>를 인가합니다. Row 주소는 함께 오지 않으며 — DRAM이 내부 카운터를 사용해 다음에 refresh할 row를 스스로 결정합니다.",
            },
            state: { ...IDLE_STATE, bus: ["REF"] },
          },
          {
            op: { en: "REF · internal ACT", ko: "REF · 내부 ACT" },
            title: { en: "Internal Row Activation", ko: "내부 row 활성화" },
            desc: {
              en: "The DRAM internally asserts the word lines pointed to by its counter. Access transistors turn on and charge sharing begins — a full activation, but driven from within the die rather than by an external ACT.",
              ko: "DRAM이 내부적으로 카운터가 가리키는 word line을 활성화합니다. Access transistor가 켜지고 전하 공유가 시작됩니다 — 완전한 활성화이지만 외부 ACT가 아닌 die 내부에서 구동됩니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [1, 2, 3],
              cellPhase: "refresh",
              rowAddr: "⟳",
              bus: ["REF"],
            },
          },
          {
            op: { en: "REF · sense / restore", ko: "REF · 센싱 / 복원" },
            title: { en: "Sense & Restore", ko: "센싱 및 복원" },
            desc: {
              en: "Sense amps latch the row and drive bit lines to full rail, restoring charge into every cell in the addressed rows. This is the entire purpose of refresh: halting the exponential decay of the storage capacitors before data is lost.",
              ko: "Sense amp가 row를 래치하고 bit line을 완전한 레벨로 구동하여, 지정된 row의 모든 셀에 전하를 복원합니다. 이것이 refresh의 전체 목적입니다: 데이터가 손실되기 전에 저장 capacitor의 지수적 감쇠를 멈추는 것.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [1, 2, 3],
              bitlines: "all",
              cellPhase: "refresh",
              senseAmpPhase: "latched",
              rowAddr: "⟳",
              bus: ["REF"],
            },
          },
          {
            op: { en: "REF · PRE + advance", ko: "REF · PRE + 진행" },
            title: {
              en: "Precharge & Counter Advance",
              ko: "Precharge 및 카운터 진행",
            },
            desc: {
              en: "The DRAM precharges the refreshed rows internally and advances its refresh counter. Many DDR4 devices refresh multiple rows per REF command, amortising the fixed per-command overhead.",
              ko: "DRAM은 refresh된 row를 내부적으로 precharge하고 refresh 카운터를 진행시킵니다. 많은 DDR4 장치는 REF 명령당 여러 row를 refresh하여 명령당 고정 오버헤드를 분산시킵니다.",
            },
            state: {
              ...IDLE_STATE,
              wordlines: [4, 5, 6],
              cellPhase: "refresh",
              rowAddr: "⟳+",
              bus: ["REF"],
            },
          },
          {
            op: { en: "REF · complete", ko: "REF · 완료" },
            title: { en: "tRFC Elapsed", ko: "tRFC 경과" },
            desc: {
              en: 'After <code>tRFC</code>, REF completes and normal commands can resume. The next REF should be issued around <code>tREFI</code>, but the JEDEC <span class="term" data-term="REFbudget">pooling budget</span> lets the controller postpone or pull-in up to 8 REFs relative to the average schedule. Drift beyond that eats into retention margin, and eventually data is lost. DDR4 8 Gb dies use tRFC ≈ 350 ns.',
              ko: '<code>tRFC</code> 후에 REF가 완료되고 일반 명령을 다시 시작할 수 있습니다. 다음 REF는 평균적으로 <code>tREFI</code> 근처에 발행되어야 하지만, JEDEC의 <span class="term" data-term="REFbudget">pooling budget</span> 덕분에 컨트롤러는 평균 스케줄 대비 최대 8개의 REF를 미리 또는 지연 발행할 수 있습니다. 그 이상 벗어나면 유지 마진이 소진되고 결국 데이터가 손실됩니다. DDR4 8 Gb 다이 기준 tRFC ≈ 350 ns.',
            },
            state: { ...IDLE_STATE, bus: ["REF"], highlightTiming: "tRFC" },
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
        en: "Row-activate command. Raises the target word line so every access transistor in that row turns on; the sense amps then latch the row into the row buffer. Only one row per bank can be active at a time.",
        ko: "Row 활성화 명령. 대상 word line을 올려 해당 row의 모든 access transistor를 켜고, sense amp가 그 row를 row buffer로 래치합니다. Bank당 한 번에 하나의 row만 활성화될 수 있습니다.",
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
        name: "BL · Burst Length",
        en: "Number of data beats transferred per column command. Modern SDRAM uses BL8 — eight beats over four clock cycles (two per cycle, one per edge).",
        ko: "Column 명령당 전송되는 데이터 비트 수. 최신 SDRAM은 BL8 사용 — 4 클록 사이클 동안 8 비트 (사이클당 2, 엣지당 1).",
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
        en: "A voltage higher than Vdd used to fully turn on the access transistors so the cell capacitor can be charged to a full Vdd level rather than Vdd − Vth.",
        ko: "Vdd보다 높은 전압. Access transistor를 완전히 켜서 셀 커패시터가 Vdd − Vth가 아닌 온전한 Vdd 레벨까지 충전될 수 있게 합니다.",
      },
      DQ: {
        name: "DQ · Data Pins",
        en: "External I/O bus that carries read and write data between the DRAM and the memory controller. Idle (high-Z) except during a burst.",
        ko: "DRAM과 메모리 컨트롤러 사이에서 read/write 데이터를 전송하는 외부 I/O 버스. Burst 구간이 아닐 때는 idle (high-Z) 상태.",
      },
      "ROW DEC": {
        name: "Row Decoder",
        en: "Circuit that decodes the row address on the command bus into a single word-line select, driving that word line to Vpp on ACT so every access transistor in the row turns on. One row decoder per bank.",
        ko: "Command bus로 들어온 row 주소를 디코딩해 하나의 word line을 선택하는 회로. ACT 시 그 word line을 Vpp까지 구동해 해당 row의 모든 access transistor를 켭니다. Bank당 하나씩 존재.",
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

      // Root scenario + language for CSS accent variable
      const app = document.querySelector(".app");
      app.setAttribute("data-scn", S.scenario);
      app.setAttribute("data-lang", S.lang);
      document.documentElement.lang = S.lang;

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
      document.getElementById("tab-refresh").textContent = t(
        scenarios.refresh.label,
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
        if (TERM_DEFS[row.name]) {
          dt.classList.add("term");
          dt.dataset.term = row.name;
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
            else if (st.cellPhase === "sensed") g.classList.add("sensed");
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
          case "3":
            switchScenario("refresh");
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
