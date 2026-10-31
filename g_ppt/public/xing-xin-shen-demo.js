(function () {
  const root = document.documentElement; // 获取根节点
  // 幻灯片嵌入：铺满容器，去掉页面底色形成的外圈
  if (new URLSearchParams(window.location.search).get('embed') === '1') {
    root.classList.add('embed')
  }

  function readPxVar(name, fallback) { // 读取CSS变量，解析为数值
    const v = getComputedStyle(root).getPropertyValue(name).trim(); // 读取变量值
    const n = parseFloat(v); // 解析为浮点数
    return Number.isFinite(n) ? n : fallback; // 校验返回，出错用默认值
  }

  // 物理相关常量
  const R = readPxVar("--ball-r", 36); // 球体半径
  const ARENA_CX = readPxVar("--arena-cx", 200); // 舞台主圆心X坐标
  const ARENA_CY = readPxVar("--arena-cy", 200); // 舞台主圆心Y坐标
  const ARENA_R = readPxVar("--arena-r", 188); // 舞台主圆半径
  const maxCenterDist = ARENA_R - R; // 球心最大允许距圆心距离
  const POS_SLOP = 0.6; //  位置松弛容差
  const SOLVER_ITERS = 8; // 约束解算迭代次数

  const SPRING_K = 0.0001; // 边弹簧常数（无阻尼）

  function dist2d(ax, ay, bx, by) { // 计算两点距离
    return Math.hypot(bx - ax, by - ay); // 欧式距离
  }

  function getStateFromQuery() { // 从URL获取状态
    const allowedStates = new Set(["icon", "asymmetric"]); // 允许的状态
    const state = new URLSearchParams(window.location.search).get("state"); // url参数
    return allowedStates.has(state) ? state : "icon"; // 合法返回，否则icon
  }

  function getLineOpacityFromQuery() { // URL获取连线不透明度
    const value = new URLSearchParams(window.location.search).get("lineOpacity"); // url参数
    if (value === null) return null; // 没指定
    const opacity = Number.parseFloat(value); // 解析
    if (!Number.isFinite(opacity)) return null; // 不合法
    return Math.max(0, Math.min(1, opacity)); // 限定范围
  }

  function getInitialBallsByState(state) { // 不同状态下的初始球参数
    if (state === "asymmetric") { // 非对称样式
      return [
        { x: 130, y: 150, vx: 5, vy: 0.85 },   // ball0
        { x: 270, y: 180, vx: 0, vy: 1.05 },   // ball1
        { x: 200, y: 260, vx: 0, vy: 0 },      // ball2
      ];
    }
    // 图标模式（整体旋转 12 度）
    const ICON_ROTATE_DEG =8;
    return [
      { x: ARENA_CX + maxCenterDist * Math.cos(((0 + ICON_ROTATE_DEG) * Math.PI) / 180), y: ARENA_CY + maxCenterDist * Math.sin(((0 + ICON_ROTATE_DEG) * Math.PI) / 180), vx: 0, vy: 0 }, // ball0 行
      { x: ARENA_CX + maxCenterDist * Math.cos(((-120 + ICON_ROTATE_DEG) * Math.PI) / 180), y: ARENA_CY + maxCenterDist * Math.sin(((-120 + ICON_ROTATE_DEG) * Math.PI) / 180), vx: 0, vy: 0 }, // ball1 心
      { x: ARENA_CX + maxCenterDist * Math.cos(((120 + ICON_ROTATE_DEG) * Math.PI) / 180), y: ARENA_CY + maxCenterDist * Math.sin(((120 + ICON_ROTATE_DEG) * Math.PI) / 180), vx: 0, vy: 0 }, // ball2
    ];
  }

  const state = getStateFromQuery(); // 当前状态
  const lineOpacity = getLineOpacityFromQuery(); // 连线透明度
  if (lineOpacity !== null) { // 如果有URL参数，则覆盖CSS变量
    root.style.setProperty("--line-opacity", String(lineOpacity)); // 设置CSS变量
  }

  /**
   * 物理初值
   * balls: 行-心-身顺序
   * restitution*: 弹性系数，1为完全弹性
   */
  const PHYS_INIT = {
    balls: getInitialBallsByState(state), // 初始球体数据
    restitutionWall: 1, // 与墙壁碰撞系数
    restitutionBall: 1, // 球与球碰撞系数
  };

  const restitutionWall = PHYS_INIT.restitutionWall; // 取出墙弹性
  const restitutionBall = PHYS_INIT.restitutionBall; // 取出球弹性

  const ballEls = [ // 三个球体SVG元素
    document.getElementById("ball0"), // 行
    document.getElementById("ball1"), // 心
    document.getElementById("ball2"), // 身
  ];
  const balls = PHYS_INIT.balls.map((s, i) => ({ // runtime球体状态
    x: s.x, // 位置x
    y: s.y, // 位置y
    vx: s.vx, // 速度x
    vy: s.vy, // 速度y
    el: ballEls[i], // 对应SVG元素
  }));

  const [p0, p1, p2] = PHYS_INIT.balls; // 取出初始三个点（用于算弹簧初长）
  const restLenAB = dist2d(p0.x, p0.y, p1.x, p1.y); // AB弹簧原长
  const restLenBC = dist2d(p1.x, p1.y, p2.x, p2.y); // BC弹簧原长
  const restLenCA = dist2d(p2.x, p2.y, p0.x, p0.y); // CA弹簧原长

  /**
   * F = k(L-L0)·û，弹簧力，保守系统
   */
  function applySpringPair(a, b, L0) { // 两端点弹簧力
    const dx = b.x - a.x; // 向量差x
    const dy = b.y - a.y; // 向量差y
    const L = Math.hypot(dx, dy); // 距离
    if (L < 1e-6) return; // 防止除零
    const ux = dx / L; // 单位向量x
    const uy = dy / L; // 单位向量y
    const ext = L - L0; // 伸长量
    const fx = SPRING_K * ext * ux; // 力x
    const fy = SPRING_K * ext * uy; // 力y
    a.vx += fx; // 叠加速度x
    a.vy += fy; // 叠加速度y
    b.vx -= fx; // 另一端反向
    b.vy -= fy;
  }

  const lineAB = document.getElementById("line-ab"); // AB连线SVG
  const lineBC = document.getElementById("line-bc"); // BC连线SVG
  const lineCA = document.getElementById("line-ca"); // CA连线SVG

  function resolveWalls(b) { // 处理球在场边界的反弹
    let dx = b.x - ARENA_CX; // 球中心到圆心的向量x
    let dy = b.y - ARENA_CY; // y分量
    let d = Math.hypot(dx, dy); // 距离
    if (d < 1e-8) { // 避免在圆心奇异
      b.x += 1e-3; // 微小扰动
      dx = b.x - ARENA_CX;
      dy = b.y - ARENA_CY;
      d = Math.hypot(dx, dy);
    }
    if (d <= maxCenterDist) return; // 没碰壁
    const nx = dx / d; // 法线x
    const ny = dy / d; // 法线y
    b.x = ARENA_CX + nx * maxCenterDist; // 推回圆内边界
    b.y = ARENA_CY + ny * maxCenterDist;
    const vn = b.vx * nx + b.vy * ny; // 法线分速度
    if (vn > 0) { // 只有朝外运动才需要反弹
      const k = (1 + restitutionWall) * vn; // 计算冲量
      b.vx -= k * nx; // 反弹法线速度
      b.vy -= k * ny;
    }
  }

  function resolvePair(a, b) { // 处理两个球碰撞
    const dx = b.x - a.x; // 相对x
    const dy = b.y - a.y; // 相对y
    const dist = Math.hypot(dx, dy); // 球心距
    const minD = 2 * R + POS_SLOP; // 最小允许距离
    if (dist < 1e-6) return; // 同位跳过
    const touching = dist < minD; // 是否相交
    let nx = dx / dist; // 法线x
    let ny = dy / dist; // 法线y
    if (touching) { // 相交调整
      const overlap = minD - dist; // 重叠量
      const k = overlap * 0.5; // 均分到双方
      a.x -= nx * k; // 推开
      a.y -= ny * k;
      b.x += nx * k;
      b.y += ny * k;
      const d2 = Math.hypot(b.x - a.x, b.y - a.y); // 修正后新距离
      if (d2 > 1e-6) { // 重算法线
        nx = (b.x - a.x) / d2;
        ny = (b.y - a.y) / d2;
      }
    }
    if (!touching) return; // 不相碰，不反弹
    const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // 相对法线速度
    if (rvn >= 0) return; // 远离就不用反弹
    const j = (-(1 + restitutionBall) * rvn) / 2; // 冲量（质量都为1）
    a.vx -= j * nx; // 分配到两球
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }

  function tick() { // 每帧主循环
    applySpringPair(balls[0], balls[1], restLenAB); // AB边弹簧
    applySpringPair(balls[1], balls[2], restLenBC); // BC边弹簧
    applySpringPair(balls[2], balls[0], restLenCA); // CA边弹簧

    for (const b of balls) { // 移动物体
      b.x += b.vx; // 位置x
      b.y += b.vy; // 位置y
    }
    for (let i = 0; i < SOLVER_ITERS; i++) { // 约束求解多次迭代
      resolvePair(balls[0], balls[1]); // AB球体碰撞
      resolvePair(balls[1], balls[2]); // BC球体碰撞
      resolvePair(balls[2], balls[0]); // CA球体碰撞
      for (const b of balls) resolveWalls(b); // 各球碰边界
    }

    const [a, b, c] = balls; // a,b,c分别对应三球
    lineAB.setAttribute("x1", a.x); // 更新SVG连线端点
    lineAB.setAttribute("y1", a.y);
    lineAB.setAttribute("x2", b.x);
    lineAB.setAttribute("y2", b.y);
    lineBC.setAttribute("x1", b.x);
    lineBC.setAttribute("y1", b.y);
    lineBC.setAttribute("x2", c.x);
    lineBC.setAttribute("y2", c.y);
    lineCA.setAttribute("x1", c.x);
    lineCA.setAttribute("y1", c.y);
    lineCA.setAttribute("x2", a.x);
    lineCA.setAttribute("y2", a.y);

    for (const ball of balls) { // 更新球SVG的变换
      ball.el.setAttribute("transform", `translate(${ball.x},${ball.y})`); // 球平移
    }
    requestAnimationFrame(tick); // 下一帧
  }

  tick(); // 启动动画
})();
