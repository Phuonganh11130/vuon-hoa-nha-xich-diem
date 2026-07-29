const TIER_META = {
  'Đỏ':  { key:'do',  color:'var(--tier-do)'  },
  'Cam': { key:'cam', color:'var(--tier-cam)' },
  'Tím': { key:'tim', color:'var(--tier-tim)' },
  'Lam': { key:'lam', color:'var(--tier-lam)' },
};
const TIER_ORDER = ['Đỏ','Cam','Tím','Lam'];

const TIER_ID_PREFIX = { 'Đỏ':'Do', 'Cam':'Cam', 'Tím':'Tim', 'Lam':'Lam' };

function nextFlowerId(tier){
  const prefix = TIER_ID_PREFIX[tier];
  if(!prefix) return '';
  const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
  let maxNum = 0;
  state.flowers.forEach(f => {
    const m = f.id.match(re);
    if(m){ const n = parseInt(m[1], 10); if(!isNaN(n) && n > maxNum) maxNum = n; }
  });
  const next = maxNum + 1;
  const width = Math.max(3, String(next).length);
  return prefix + String(next).padStart(width, '0');
}

function nextMemberIdAcc(){
  let maxNum = 0;
  state.members.forEach(m => {
    const n = parseInt(m.idAcc, 10);
    if(!isNaN(n) && n > maxNum) maxNum = n;
  });
  return String(maxNum + 1);
}

/* Hỏi thẳng Supabase để lấy ID_Acc lớn nhất hiện có, thay vì dựa vào state.members
   đã tải sẵn (có thể cũ nếu trang mở lâu). Dùng khi mở form "Thêm thành viên mới"
   và khi cần thử lại vì bị trùng khóa. */
async function fetchNextMemberIdAcc(){
  const { data, error } = await supabaseClient
    .from('members')
    .select('ID_Acc')
    .order('ID_Acc', { ascending: false })
    .limit(1);
  if(error || !data || !data.length) return nextMemberIdAcc();
  const maxNum = Number(data[0].ID_Acc) || 0;
  return String(maxNum + 1);
}

/* Tương tự cho mã hoa: hỏi Supabase các ID cùng hạng màu để tính ID kế tiếp mới nhất. */
async function fetchNextFlowerId(tier){
  const prefix = TIER_ID_PREFIX[tier];
  if(!prefix) return '';
  const { data, error } = await supabaseClient
    .from('flowers')
    .select('ID_Hoa')
    .ilike('ID_Hoa', prefix + '%');
  if(error) return nextFlowerId(tier);
  const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
  let maxNum = 0;
  (data||[]).forEach(row => {
    const m = String(row.ID_Hoa||'').match(re);
    if(m){ const n = parseInt(m[1],10); if(!isNaN(n) && n>maxNum) maxNum = n; }
  });
  const next = maxNum + 1;
  const width = Math.max(3, String(next).length);
  return prefix + String(next).padStart(width, '0');
}

/* ---------------- local-only persistence ----------------
   Sau refactor, Supabase là nguồn dữ liệu duy nhất cho flowers/members/quan hệ sở hữu.
   CHỈ avatar (ảnh đại diện) vẫn lưu localStorage riêng theo từng máy — theo yêu cầu,
   phần này chưa cần đồng bộ đa thiết bị. */
const AVATARS_KEY = 'hoaSoHuu_avatars_v1';

const state = {
  flowers: [],      // [{id,name,tier,status,listAccNames:[],image}]
  members: [],      // [{key,idAcc,name,zalo,baseFlowerIds:[]}]  — key = idAcc (khóa cố định)
  avatars: {},          // memberKey -> avatar image data URL (chỉ lưu local, xem ghi chú trên)
  ownersByFlower: {},   // flowerId -> [memberKey,...]  (tính từ baseFlowerIds)
  flowersByMember: {},  // memberKey -> [flowerId,...]  (tính từ baseFlowerIds)
  flowerById: {},
  memberByKey: {},
  loaded: false,
};

function loadAvatars(){
  try{
    const raw = localStorage.getItem(AVATARS_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(e){ return {}; }
}
function saveAvatars(){
  try{ localStorage.setItem(AVATARS_KEY, JSON.stringify(state.avatars)); }
  catch(e){ /* storage unavailable — avatar chỉ tồn tại trong phiên này */ }
}

function getEffectiveFlowerIds(member){
  return member.baseFlowerIds;
}

/* Cột ID_Acc trên Supabase là kiểu int, trong khi JS luôn giữ idAcc dạng string
   (để dùng làm object key/route). Mọi lệnh gửi lên Supabase (.eq, insert) phải
   convert qua Number() ở đây, nếu không PostgREST sẽ không khớp được dòng nào
   mà không báo lỗi rõ ràng. */
function toIdAccNum(idAcc){
  const n = Number(idAcc);
  return Number.isFinite(n) ? n : null;
}

/* rebuild ownersByFlower / flowersByMember từ state.members hiện tại.
   Gọi lại sau khi load data và sau mỗi lần ghi Supabase thành công. */
function computeRelationships(){
  const ownersByFlower = {};
  const flowersByMember = {};
  state.flowers.forEach(f => ownersByFlower[f.id] = []);
  state.members.forEach(m => {
    const ids = getEffectiveFlowerIds(m).filter(id => state.flowerById[id]);
    flowersByMember[m.key] = ids;
    ids.forEach(id => ownersByFlower[id].push(m.key));
  });
  state.ownersByFlower = ownersByFlower;
  state.flowersByMember = flowersByMember;
}

function splitList(str){
  if(!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

async function loadData(){
  const [
    { data: flowerRows, error: flowerError },
    { data: memberRows, error: memberError }
  ] = await Promise.all([
    supabaseClient.from("flowers").select("*"),
    supabaseClient.from("members").select("*")
  ]);

  if (flowerError) throw flowerError;
  if (memberError) throw memberError;

  // key = ID_Acc: đây là khóa định danh CỐ ĐỊNH, khớp với các lệnh .eq("ID_Acc", ...)
  // dùng để update Supabase ở các nơi khác trong file. Vì vậy ID_Acc không cho sửa
  // trong màn "Sửa thông tin thành viên" (xem memberInfoEditShell).
  state.members = memberRows.map(row => {
    const idAcc = String(row['ID_Acc'] ?? '').trim();
    return {
      key: idAcc,
      idAcc,
      name: String(row['Tên Game'] ?? '').trim(),
      zalo: String(row['Zalo'] ?? '').trim(),
      rawFlowerIds: splitList(String(row['ID_Hoa_So_Huu'] ?? '')),
      baseFlowerIds: [],
    };
  }).filter(m => m.name && m.key);

  state.flowers = flowerRows.map(row => ({
    id: (row['ID_Hoa']||'').trim(),
    name: (row['Name']||'').trim(),
    tier: (row['flower_color']||'').trim(),
    listAccNames: splitList(row['List Acc']),
    image: (row['Image']||'').trim(),
    status: (row['Trạng Thái']||'').trim(),
  })).filter(f => f.id);

  state.flowerById = Object.fromEntries(state.flowers.map(f => [f.id, f]));
  state.memberByKey = Object.fromEntries(state.members.map(m => [m.key, m]));

  // Sở hữu gốc — CHỈ dựa vào cột ID_Hoa_So_Huu (đây là nguồn duy nhất mà giao diện ghi vào).
  // Trước đây có gộp thêm theo tên trong cột "List Acc" của flowers, nhưng cột đó không được
  // đồng bộ khi sửa qua giao diện, nên hoa đã gỡ khỏi ID_Hoa_So_Huu sẽ bị "hồi sinh" lại mỗi lần
  // tải trang nếu tên thành viên còn nằm trong List Acc. Cột List Acc vẫn giữ trên Supabase để
  // tham khảo/tìm kiếm (xem paintFlowerGrid), chỉ không dùng để tính sở hữu nữa.
  state.members.forEach(m => {
    m.baseFlowerIds = m.rawFlowerIds.filter(id => state.flowerById[id]);
  });

  state.avatars = loadAvatars();
  computeRelationships();

  state.loaded = true;
}

/* ---------------- helpers ---------------- */
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function initials(name){
  const parts = name.trim().split(/\s+/);
  const last2 = parts.slice(-2);
  return last2.map(p => p[0]).join('').toUpperCase().slice(0,2);
}
function avatarHTML(m, cls){
  cls = cls || 'avatar';
  const src = state.avatars[m.key];
  if(src) return `<img class="${cls} avatar-img" src="${src}" alt="Ảnh đại diện ${esc(m.name)}">`;
  return `<span class="${cls}">${esc(initials(m.name))}</span>`;
}
function tierColor(tier){
  return (TIER_META[tier] && TIER_META[tier].color) || 'var(--ink-faint)';
}
function flowerMediaInner(f){
  return '🌸';
}

/* ---------------- routing ---------------- */
function currentRoute(){
  const hash = location.hash.replace(/^#/,'') || '/hoa';
  const parts = hash.split('/').filter(Boolean);
  return parts;
}

function navActive(routeKey){
  document.querySelectorAll('[data-route]').forEach(a=>{
    a.classList.toggle('active', a.dataset.route === routeKey);
  });
}

async function render(){
  const app = document.getElementById('app');
  if(!state.loaded){
    app.innerHTML = `<div class="skeleton"><div class="spin"></div>Đang tải sổ hoa…</div>`;
    try{
      await loadData();
    }catch(err){
      app.innerHTML = `<div class="empty-state"><span class="em-ico">⚠️</span>Không tải được dữ liệu<br><small>${esc(err.message||err)}</small></div>`;
      return;
    }
  }

  const parts = currentRoute();
  const [section, param] = parts;

  if(section === 'thanhvien' && param){
    navActive('thanhvien');
    renderMemberDetail(param);
  } else if(section === 'thanhvien'){
    navActive('thanhvien');
    renderMemberList();
  } else if(section === 'hoa' && param){
    navActive('hoa');
    renderFlowerDetail(param);
  } else {
    navActive('hoa');
    renderFlowerList();
  }
  window.scrollTo({top:0, behavior:'instant' in window.scrollTo ? 'instant' : 'auto'});
}

/* ---------------- Flower list page ---------------- */
let flowerFilters = { q:'', tier:'', status:'', sort:'id-asc' };
let addFlowerState = null; // { name, tier, status, search:'', selected:Set<memberKey>, error:'' }

function renderFlowerList(){
  const app = document.getElementById('app');

  if(addFlowerState){
    app.innerHTML = addFlowerShell();
    wireAddFlower();
    paintNewFlowerMemberChecklist();
    return;
  }

  app.innerHTML = `
    <div class="scroll-banner">Danh Sách Hoa</div>
    <div class="tier-chips" id="tierChips">
      ${chipHTML('', 'Tất cả', '#C4923F')}
      ${TIER_ORDER.map(t => chipHTML(t, t, tierColor(t))).join('')}
    </div>
    <div class="toolbar">
      <div class="search-box">
        <span>🔎</span>
        <input id="fSearch" type="text" placeholder="Tìm theo tên hoa, tên tài khoản" value="${esc(flowerFilters.q)}">
      </div>
      <div class="select-field">
        <label>Trạng thái</label>
        <select id="fStatus">
          <option value="">Tất cả</option>
          <option value="yes">Đã có</option>
          <option value="no">Chưa có</option>
        </select>
      </div>
      <div class="select-field">
        <label>Sắp xếp</label>
        <select id="fSort">
          <option value="id-asc">Mã ID (A→Z)</option>
          <option value="name-asc">Tên (A→Z)</option>
          <option value="name-desc">Tên (Z→A)</option>
          <option value="owners-desc">Nhiều chủ sở hữu nhất</option>
          <option value="owners-asc">Ít chủ sở hữu nhất</option>
        </select>
      </div>
      <div class="result-count" id="resultCount"></div>
      <button class="btn-export" id="btnAddFlower" title="Thêm một đóa hoa mới vào danh sách">➕ Thêm hoa mới</button>
    </div>
    <div class="grid" id="flowerGrid"></div>
  `;

  document.getElementById('fSearch').value = flowerFilters.q;
  document.getElementById('fStatus').value = flowerFilters.status;
  document.getElementById('fSort').value = flowerFilters.sort;

  document.getElementById('fSearch').addEventListener('input', e => { flowerFilters.q = e.target.value; paintFlowerGrid(); });
  document.getElementById('fStatus').addEventListener('change', e => { flowerFilters.status = e.target.value; paintFlowerGrid(); });
  document.getElementById('fSort').addEventListener('change', e => { flowerFilters.sort = e.target.value; paintFlowerGrid(); });
  document.getElementById('tierChips').addEventListener('click', e => {
    const chip = e.target.closest('.tier-chip');
    if(!chip) return;
    flowerFilters.tier = chip.dataset.tier;
    paintFlowerGrid();
    syncChipActive();
  });
  document.getElementById('btnAddFlower').addEventListener('click', () => {
    addFlowerState = { name:'', tier:'', status:'Chưa Có', search:'', selected:new Set(), error:'' };
    renderFlowerList();
  });
  // ID hiển thị ban đầu dựa vào state cục bộ (nhanh); ID thật sẽ được xác nhận lại
  // với Supabase ngay trước khi lưu (xem wireAddFlower's btnSaveNewFlower).

  syncChipActive();
  paintFlowerGrid();
}

function chipHTML(tierVal, label, color){
  return `<button class="tier-chip" data-tier="${esc(tierVal)}" style="--c:${color}">
    <span class="dot" style="background:${color}"></span>${esc(label)}
  </button>`;
}
function syncChipActive(){
  document.querySelectorAll('#tierChips .tier-chip').forEach(c=>{
    const active = c.dataset.tier === flowerFilters.tier;
    c.classList.toggle('active', active);
    c.style.background = active ? c.style.getPropertyValue('--c') : '';
  });
}

function paintFlowerGrid(){
  const grid = document.getElementById('flowerGrid');
  const countEl = document.getElementById('resultCount');
  let list = state.flowers.slice();

  const q = flowerFilters.q.trim().toLowerCase();
  if(q){
    list = list.filter(f => {
      if(f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) return true;
      const owners = (state.ownersByFlower[f.id]||[]).map(k => state.memberByKey[k]).filter(Boolean);
      if(owners.some(m => m.name.toLowerCase().includes(q) || (m.idAcc||'').toLowerCase().includes(q))) return true;
      if((f.listAccNames||[]).some(nm => nm.toLowerCase().includes(q))) return true;
      return false;
    });
  }
  if(flowerFilters.tier){
    list = list.filter(f => f.tier === flowerFilters.tier);
  }
  if(flowerFilters.status === 'yes'){
    list = list.filter(f => f.status === 'Đã Có');
  } else if(flowerFilters.status === 'no'){
    list = list.filter(f => f.status !== 'Đã Có');
  }

  const ownersCount = f => (state.ownersByFlower[f.id]||[]).length;
  switch(flowerFilters.sort){
    case 'name-asc': list.sort((a,b)=>a.name.localeCompare(b.name,'vi')); break;
    case 'name-desc': list.sort((a,b)=>b.name.localeCompare(a.name,'vi')); break;
    case 'owners-desc': list.sort((a,b)=>ownersCount(b)-ownersCount(a)); break;
    case 'owners-asc': list.sort((a,b)=>ownersCount(a)-ownersCount(b)); break;
    default: list.sort((a,b)=>a.id.localeCompare(b.id)); break;
  }

  countEl.textContent = `${list.length} / ${state.flowers.length} đóa hoa`;

  if(!list.length){
    grid.innerHTML = `<div class="empty-state"><span class="em-ico">🥀</span>Không tìm thấy đóa hoa nào phù hợp.</div>`;
    return;
  }

  grid.innerHTML = list.map(f => {
    const color = tierColor(f.tier);
    const owners = (state.ownersByFlower[f.id]||[]).map(k => state.memberByKey[k]).filter(Boolean);
    return `
    <div class="flower-card">
      <a class="fc-link" href="#/hoa/${encodeURIComponent(f.id)}" data-link>
        <div class="fc-media" style="background:linear-gradient(135deg, ${color}, ${color}CC)">
          ${flowerMediaInner(f)}
          ${f.tier ? `<span class="fc-tier-badge" style="background:${color}">${esc(f.tier)}</span>` : ''}
          <span class="fc-status" title="${f.status==='Đã Có' ? 'Đã có trong vườn':'Chưa có'}">${f.status==='Đã Có' ? '✅' : '🌱'}</span>
        </div>
        <div class="fc-top">
          <span class="fc-id">${esc(f.id)}</span>
          <span class="fc-name">${esc(f.name)}</span>
        </div>
      </a>
      <div class="fc-owners">
        ${owners.length
          ? owners.map(m => `<a class="fc-owner-chip" href="#/thanhvien/${m.key}" data-link>${esc(m.name)}</a>`).join('')
          : `<span class="fc-no-owner">Chưa có ai sở hữu</span>`}
      </div>
    </div>`;
  }).join('');
}

/* ---------------- Add new flower ---------------- */
function addFlowerShell(){
  const s = addFlowerState;
  return `
    <div class="detail-wrap">
      <a class="back-link" href="#/hoa" data-link id="linkCancelAddFlower">← Quay lại Danh Sách Hoa</a>
      <div class="detail-card">
        <div class="member-detail-head">
          <span class="avatar">🌸</span>
          <div>
            <h1>Thêm hoa mới</h1>
            <div class="sub">Nhập thông tin đóa hoa, chọn chủ sở hữu (nếu có) rồi bấm Lưu</div>
          </div>
        </div>
        <div class="edit-toolbar" style="flex-wrap:wrap;">
          <div class="select-field">
            <label>Hạng màu</label>
            <select id="newFlowerTier">
              <option value="">— Chọn hạng —</option>
              ${TIER_ORDER.map(t => `<option value="${esc(t)}" ${s.tier===t?'selected':''}>${esc(t)}</option>`).join('')}
            </select>
          </div>
          <div class="select-field">
            <label>Mã đóa hoa (ID) — tự động</label>
            <input id="newFlowerId" type="text" value="${esc(s.tier ? nextFlowerId(s.tier) : '')}" placeholder="Chọn hạng màu" disabled>
          </div>
          <div class="select-field" style="flex:1 1 220px;">
            <label>Tên hoa</label>
            <input id="newFlowerName" type="text" placeholder="Tên hoa" value="${esc(s.name)}">
          </div>
          <div class="select-field">
            <label>Trạng thái</label>
            <select id="newFlowerStatus">
              <option value="Đã Có" ${s.status==='Đã Có'?'selected':''}>Đã Có</option>
              <option value="Chưa Có" ${s.status!=='Đã Có'?'selected':''}>Chưa Có</option>
            </select>
          </div>
        </div>
        ${s.error ? `<div class="empty-state" style="padding:10px 14px;"><span class="em-ico">⚠️</span>${esc(s.error)}</div>` : ''}
        <div class="edit-toolbar">
          <div class="search-box">
            <span>🔎</span>
            <input id="newFlowerMemberSearch" type="text" placeholder="Tìm thành viên để gán làm chủ sở hữu">
          </div>
          <span class="edit-selected-count" id="newFlowerSelectedCount"></span>
        </div>
        <div class="edit-checklist" id="newFlowerMemberChecklist"></div>
        <div class="edit-actions">
          <button class="btn-primary" id="btnSaveNewFlower">💾 Lưu hoa mới</button>
          <button class="btn-ghost" id="btnCancelAddFlower">Hủy</button>
        </div>
      </div>
    </div>
  `;
}

function wireAddFlower(){
  const cancel = () => { addFlowerState = null; renderFlowerList(); };
  document.getElementById('linkCancelAddFlower').addEventListener('click', (e) => { e.preventDefault(); cancel(); });
  document.getElementById('btnCancelAddFlower').addEventListener('click', cancel);

  document.getElementById('newFlowerName').addEventListener('input', e => { addFlowerState.name = e.target.value; });
  document.getElementById('newFlowerTier').addEventListener('change', e => {
    addFlowerState.tier = e.target.value;
    renderFlowerList();
  });
  document.getElementById('newFlowerStatus').addEventListener('change', e => { addFlowerState.status = e.target.value; });
  document.getElementById('newFlowerMemberSearch').addEventListener('input', e => {
    addFlowerState.search = e.target.value; paintNewFlowerMemberChecklist();
  });

  document.getElementById('btnSaveNewFlower').addEventListener('click', async () => {
    const name = addFlowerState.name.trim();
    const tier = document.getElementById('newFlowerTier').value;
    const status = document.getElementById('newFlowerStatus').value;

    if(!tier){
      addFlowerState.error = 'Vui lòng chọn hạng màu để tạo mã ID.';
      renderFlowerList();
      return;
    }
    if(!name){
      addFlowerState.error = 'Vui lòng nhập tên hoa.';
      renderFlowerList();
      return;
    }

    const saveBtn = document.getElementById('btnSaveNewFlower');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu…';

    let id = await fetchNextFlowerId(tier);
    let insertErr = null;
    for(let attempt = 0; attempt < 5; attempt++){
      const res = await supabaseClient
        .from('flowers')
        .insert([{ ID_Hoa: id, Name: name, flower_color: tier, 'Trạng Thái': status, Image: '', 'List Acc': '' }]);
      insertErr = res.error;
      if(!insertErr) break;
      // mã bị trùng (người khác vừa thêm hoa cùng lúc) — hỏi lại Supabase và thử id kế tiếp
      if(insertErr.code === '23505' || /duplicate key/i.test(insertErr.message||'')){
        id = await fetchNextFlowerId(tier);
        continue;
      }
      break; // lỗi khác (mạng, RLS...) — dừng thử lại, báo lỗi luôn
    }

    if(insertErr){
      console.error(insertErr);
      addFlowerState.error = 'Lưu hoa thất bại: ' + (insertErr.message || String(insertErr));
      renderFlowerList();
      return;
    }

    // gán chủ sở hữu đã chọn — tải lại danh sách hoa MỚI NHẤT của từng người trước khi
    // gộp thêm hoa mới vào, tránh ghi đè lên thay đổi mới hơn mà người khác vừa lưu.
    const selectedMembers = Array.from(addFlowerState.selected).map(k => state.memberByKey[k]).filter(Boolean);
    for(const m of selectedMembers){
      let currentIds = m.baseFlowerIds;
      try{
        const { data, error: fetchErr } = await supabaseClient
          .from('members')
          .select('ID_Hoa_So_Huu')
          .eq('ID_Acc', toIdAccNum(m.idAcc))
          .single();
        if(!fetchErr && data) currentIds = splitList(String(data.ID_Hoa_So_Huu ?? ''));
      }catch(e){ /* mạng lỗi — vẫn dùng dữ liệu đang có, đỡ hơn là bỏ qua hẳn thành viên này */ }

      const idsArr = Array.from(new Set([...currentIds, id]));
      const { error: updErr } = await supabaseClient
        .from('members')
        .update({ ID_Hoa_So_Huu: idsArr.join(',') })
        .eq('ID_Acc', toIdAccNum(m.idAcc));
      if(updErr){
        console.error(updErr);
        continue; // hoa đã lưu thành công; chủ sở hữu này có thể gán lại thủ công sau
      }
      m.rawFlowerIds = idsArr;
      m.baseFlowerIds = idsArr;
    }

    const newFlower = { id, name, tier, status, listAccNames:[], image:'' };
    state.flowers.push(newFlower);
    state.flowerById[id] = newFlower;

    computeRelationships();
    addFlowerState = null;
    location.hash = `#/hoa/${encodeURIComponent(id)}`;
  });
}

function paintNewFlowerMemberChecklist(){
  const box = document.getElementById('newFlowerMemberChecklist');
  const q = addFlowerState.search.trim().toLowerCase();
  let list = state.members.slice();
  if(q) list = list.filter(m => m.name.toLowerCase().includes(q) || (m.idAcc||'').toLowerCase().includes(q));
  list.sort((a,b)=>a.name.localeCompare(b.name,'vi'));

  document.getElementById('newFlowerSelectedCount').textContent = `${addFlowerState.selected.size} thành viên đã chọn`;

  if(!list.length){
    box.innerHTML = `<div class="empty-state"><span class="em-ico">🙅</span>Không tìm thấy thành viên nào phù hợp.</div>`;
    return;
  }

  box.innerHTML = list.map(m => {
    const checked = addFlowerState.selected.has(m.key);
    return `
    <label class="edit-row ${checked ? 'checked':''}">
      <input type="checkbox" data-mkey="${esc(m.key)}" ${checked ? 'checked':''}>
      <span class="avatar" style="width:32px; height:32px; font-size:12px;">${esc(initials(m.name))}</span>
      <span class="fm-name">${esc(m.name)}</span>
      <span class="fm-id">${esc(m.idAcc||'')}</span>
    </label>`;
  }).join('');

  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      const key = e.target.dataset.mkey;
      if(e.target.checked) addFlowerState.selected.add(key);
      else addFlowerState.selected.delete(key);
      e.target.closest('.edit-row').classList.toggle('checked', e.target.checked);
      document.getElementById('newFlowerSelectedCount').textContent = `${addFlowerState.selected.size} thành viên đã chọn`;
    });
  });
}

/* ---------------- Flower detail page ---------------- */
function renderFlowerDetail(id){
  const app = document.getElementById('app');
  const f = state.flowerById[id];
  if(!f){
    app.innerHTML = notFound('hoa', 'Không tìm thấy đóa hoa này.');
    return;
  }
  const color = tierColor(f.tier);
  const ownerKeys = state.ownersByFlower[f.id] || [];
  const owners = ownerKeys.map(k => state.memberByKey[k]).filter(Boolean);

  app.innerHTML = `
    <div class="detail-wrap">
      <a class="back-link" href="#/hoa" data-link>← Quay lại Danh Sách Hoa</a>
      <div class="detail-card">
        <div class="detail-hero" style="background:linear-gradient(135deg, ${color}, ${color}CC)">
          ${flowerMediaInner(f)}
          <div class="hero-caption"><h1>${esc(f.name)}</h1></div>
        </div>
        <div class="detail-body">
          <div class="dp-row">
            <span class="dp-label">Mã đóa hoa</span>
            <span class="dp-value">${esc(f.id)}</span>
          </div>
          <div class="dp-row">
            <span class="dp-label">Hạng màu</span>
            <span class="dp-value"><span class="pill" style="background:${color}">${esc(f.tier || '—')}</span></span>
          </div>
          <div class="dp-row">
            <span class="dp-label">Trạng thái</span>
            <span class="dp-value">
              <span class="pill ${f.status==='Đã Có' ? 'status-yes':'status-no'}">
                ${f.status==='Đã Có' ? '✅ Đã Có' : '🌱 Chưa Có'}
              </span>
            </span>
          </div>
          <div class="dp-row" style="flex-direction:column; align-items:stretch;">
            <div class="owners-block">
              <div class="owners-title">Chủ sở hữu (${owners.length})</div>
              ${owners.length ? `<div class="owner-list">${owners.map(m => `
                <a class="owner-chip" href="#/thanhvien/${m.key}" data-link>
                  ${avatarHTML(m, 'av')}${esc(m.name)}
                </a>`).join('')}</div>`
                : `<span class="no-owner-note">Chưa có thành viên nào sở hữu hoa này.</span>`}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ---------------- Member list page ---------------- */
let memberFilters = { q:'', sort:'name-asc' };
let addMemberState = null; // { name, zalo, idAcc, avatarDataUrl, search:'', tier:'', selected:Set<flowerId>, error:'' }

function renderMemberList(){
  const app = document.getElementById('app');

  if(addMemberState){
    app.innerHTML = addMemberShell();
    wireAddMember();
    paintAddMemberChecklist();
    return;
  }

  app.innerHTML = `
    <div class="scroll-banner">Thành Viên</div>
    <div class="toolbar">
      <div class="search-box">
        <span>🔎</span>
        <input id="mSearch" type="text" placeholder="Tìm theo tên trong game hoặc Zalo" value="${esc(memberFilters.q)}">
      </div>
      <div class="select-field">
        <label>Sắp xếp</label>
        <select id="mSort">
          <option value="name-asc">Tên (A→Z)</option>
          <option value="name-desc">Tên (Z→A)</option>
          <option value="flowers-desc">Nhiều hoa nhất</option>
          <option value="flowers-asc">Ít hoa nhất</option>
        </select>
      </div>
      <div class="result-count" id="mCount"></div>
      <button class="btn-export" id="btnAddMember" title="Thêm một thành viên mới vào danh sách">➕ Thêm thành viên</button>
      <button class="btn-export" id="btnExportCSV" title="Tải file Thành_Viên.csv theo dữ liệu hiện tại">⬇️ Xuất file CSV</button>
    </div>
    <div class="member-grid" id="memberGrid"></div>
  `;
  document.getElementById('mSearch').value = memberFilters.q;
  document.getElementById('mSort').value = memberFilters.sort;
  document.getElementById('mSearch').addEventListener('input', e => { memberFilters.q = e.target.value; paintMemberGrid(); });
  document.getElementById('mSort').addEventListener('change', e => { memberFilters.sort = e.target.value; paintMemberGrid(); });
  document.getElementById('btnExportCSV').addEventListener('click', exportMembersCSV);
  document.getElementById('btnAddMember').addEventListener('click', async () => {
    addMemberState = { name:'', zalo:'', idAcc:'…', avatarDataUrl:'', search:'', tier:'', selected:new Set(), error:'' };
    renderMemberList();
    addMemberState.idAcc = await fetchNextMemberIdAcc();
    if(addMemberState) renderMemberList(); // vẫn đang ở form thêm thành viên thì cập nhật lại ID hiển thị
  });
  paintMemberGrid();
}

/* ---------------- Add new member ---------------- */
function addMemberShell(){
  const s = addMemberState;
  return `
    <div class="detail-wrap">
      <a class="back-link" href="#/thanhvien" data-link id="linkCancelAddMember">← Quay lại Thành Viên</a>
      <div class="detail-card">
        <div class="member-detail-head">
          ${s.avatarDataUrl
            ? `<img class="avatar avatar-img" id="newMemberAvatarPreview" src="${s.avatarDataUrl}" alt="Xem trước ảnh đại diện">`
            : `<span class="avatar" id="newMemberAvatarPreview">${esc(initials(s.name || '?'))}</span>`}
          <div>
            <h1>Thêm thành viên mới</h1>
            <div class="sub">Nhập thông tin thành viên, có thể gán sẵn hoa sở hữu rồi bấm Lưu</div>
          </div>
        </div>
        <div class="edit-toolbar" style="flex-wrap:wrap;">
          <div class="select-field">
            <label>Tên trong game</label>
            <input id="newMemberName" type="text" placeholder="Tên trong game" value="${esc(s.name)}">
          </div>
          <div class="select-field">
            <label>Zalo</label>
            <input id="newMemberZalo" type="text" placeholder="Tên Zalo" value="${esc(s.zalo)}">
          </div>
          <div class="select-field">
            <label>ID_Acc — tự động</label>
            <input id="newMemberIdAcc" type="text" value="${esc(s.idAcc)}" disabled>
          </div>
          <div class="select-field">
            <label>Ảnh đại diện</label>
            <input id="newMemberAvatarFile" type="file" accept="image/*">
          </div>
        </div>
        ${s.error ? `<div class="empty-state" style="padding:10px 14px;"><span class="em-ico">⚠️</span>${esc(s.error)}</div>` : ''}
        <div class="edit-toolbar">
          <div class="search-box">
            <span>🔎</span>
            <input id="newMemberFlowerSearch" type="text" placeholder="Tìm hoa để gán làm sở hữu (không bắt buộc)">
          </div>
          <div class="tier-chips" id="newMemberTierChips">
            ${chipHTML('', 'Tất cả', '#C4923F')}
            ${TIER_ORDER.map(t => chipHTML(t, t, tierColor(t))).join('')}
          </div>
          <span class="edit-selected-count" id="newMemberSelectedCount"></span>
        </div>
        <div class="edit-checklist" id="newMemberFlowerChecklist"></div>
        <div class="edit-actions">
          <button class="btn-primary" id="btnSaveNewMember">💾 Lưu thành viên mới</button>
          <button class="btn-ghost" id="btnCancelAddMember">Hủy</button>
        </div>
      </div>
    </div>
  `;
}

function wireAddMember(){
  const cancel = () => { addMemberState = null; renderMemberList(); };
  document.getElementById('linkCancelAddMember').addEventListener('click', (e) => { e.preventDefault(); cancel(); });
  document.getElementById('btnCancelAddMember').addEventListener('click', cancel);

  document.getElementById('newMemberName').addEventListener('input', e => { addMemberState.name = e.target.value; });
  document.getElementById('newMemberZalo').addEventListener('input', e => { addMemberState.zalo = e.target.value; });
  document.getElementById('newMemberAvatarFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { addMemberState.avatarDataUrl = reader.result; renderMemberList(); };
    reader.readAsDataURL(file);
  });
  document.getElementById('newMemberFlowerSearch').addEventListener('input', e => {
    addMemberState.search = e.target.value; paintAddMemberChecklist();
  });
  document.getElementById('newMemberTierChips').addEventListener('click', e => {
    const chip = e.target.closest('.tier-chip');
    if(!chip) return;
    addMemberState.tier = chip.dataset.tier;
    paintAddMemberChecklist();
    document.querySelectorAll('#newMemberTierChips .tier-chip').forEach(c=>{
      const active = c.dataset.tier === addMemberState.tier;
      c.classList.toggle('active', active);
      c.style.background = active ? c.style.getPropertyValue('--c') : '';
    });
  });

  document.getElementById('btnSaveNewMember').addEventListener('click', async () => {
    const name = addMemberState.name.trim();
    if(!name){
      addMemberState.error = 'Vui lòng nhập tên trong game.';
      renderMemberList();
      return;
    }
    const zalo = addMemberState.zalo.trim();
    const flowerIds = Array.from(addMemberState.selected);

    const saveBtn = document.getElementById('btnSaveNewMember');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu…';

    let idAcc = addMemberState.idAcc.trim();
    let insertErr = null;
    for(let attempt = 0; attempt < 5; attempt++){
      try{
        const res = await supabaseClient
          .from('members')
          .insert([{ ID_Acc: toIdAccNum(idAcc), 'Tên Game': name, Zalo: zalo, ID_Hoa_So_Huu: flowerIds.join(',') }]);
        insertErr = res.error;
      }catch(networkErr){
        insertErr = networkErr;
      }
      if(!insertErr) break;
      if(insertErr.code === '23505' || /duplicate key/i.test(insertErr.message||'')){
        idAcc = await fetchNextMemberIdAcc();
        continue;
      }
      break; // lỗi khác (mạng, RLS...) — dừng thử lại, báo lỗi luôn
    }

    if(insertErr){
      console.error(insertErr);
      addMemberState.error = 'Lưu thành viên thất bại: ' + (insertErr.message || String(insertErr));
      renderMemberList();
      return;
    }

    const key = idAcc;
    const newMember = { key, idAcc, name, zalo, rawFlowerIds: flowerIds, baseFlowerIds: flowerIds.slice() };
    state.members.push(newMember);
    state.memberByKey[key] = newMember;

    if(addMemberState.avatarDataUrl){
      state.avatars[key] = addMemberState.avatarDataUrl;
      saveAvatars();
    }

    computeRelationships();
    addMemberState = null;
    location.hash = `#/thanhvien/${key}`;
  });
}

function paintAddMemberChecklist(){
  const box = document.getElementById('newMemberFlowerChecklist');
  const q = addMemberState.search.trim().toLowerCase();
  let list = state.flowers.slice();
  if(q) list = list.filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  if(addMemberState.tier) list = list.filter(f => f.tier === addMemberState.tier);
  list.sort((a,b)=>a.id.localeCompare(b.id));

  document.getElementById('newMemberSelectedCount').textContent = `${addMemberState.selected.size} hoa đã chọn`;

  if(!list.length){
    box.innerHTML = `<div class="empty-state"><span class="em-ico">🥀</span>Không tìm thấy đóa hoa nào phù hợp.</div>`;
    return;
  }

  box.innerHTML = list.map(f => {
    const color = tierColor(f.tier);
    const checked = addMemberState.selected.has(f.id);
    return `
    <label class="edit-row ${checked ? 'checked':''}">
      <input type="checkbox" data-fid="${esc(f.id)}" ${checked ? 'checked':''}>
      <span class="fm-swatch" style="background:${color}">🌸</span>
      <span class="fm-name">${esc(f.name)}</span>
      <span class="fm-id">${esc(f.id)}</span>
    </label>`;
  }).join('');

  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      const fid = e.target.dataset.fid;
      if(e.target.checked) addMemberState.selected.add(fid);
      else addMemberState.selected.delete(fid);
      e.target.closest('.edit-row').classList.toggle('checked', e.target.checked);
      document.getElementById('newMemberSelectedCount').textContent = `${addMemberState.selected.size} hoa đã chọn`;
    });
  });
}

/* xuất Thành_Viên.csv theo dữ liệu Supabase hiện tại (bản sao lưu/tham khảo, không phải nguồn dữ liệu) */
function csvField(str){
  const s = String(str ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function exportMembersCSV(){
  const header = ['ID_Acc','Tên Game','Zalo','ID_Hoa_So_Huu'];
  const lines = [header.join(',')];
  state.members.forEach(m => {
    const ids = getEffectiveFlowerIds(m);
    lines.push([m.idAcc, m.name, m.zalo, ids.join(',')].map(csvField).join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Thanh_Vien.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function paintMemberGrid(){
  const grid = document.getElementById('memberGrid');
  const countEl = document.getElementById('mCount');
  let list = state.members.slice();
  const q = memberFilters.q.trim().toLowerCase();
  if(q){
    list = list.filter(m => m.name.toLowerCase().includes(q) || m.zalo.toLowerCase().includes(q));
  }
  const fc = m => (state.flowersByMember[m.key]||[]).length;
  switch(memberFilters.sort){
    case 'name-desc': list.sort((a,b)=>b.name.localeCompare(a.name,'vi')); break;
    case 'flowers-desc': list.sort((a,b)=>fc(b)-fc(a)); break;
    case 'flowers-asc': list.sort((a,b)=>fc(a)-fc(b)); break;
    default: list.sort((a,b)=>a.name.localeCompare(b.name,'vi')); break;
  }
  countEl.textContent = `${list.length} / ${state.members.length} thành viên`;

  if(!list.length){
    grid.innerHTML = `<div class="empty-state"><span class="em-ico">🙅</span>Không tìm thấy thành viên nào.</div>`;
    return;
  }

  grid.innerHTML = list.map(m => `
    <a class="member-card" href="#/thanhvien/${m.key}" data-link>
      ${avatarHTML(m)}
      <span class="member-info">
        <div class="member-name">${esc(m.name)}</div>
        <div class="member-zalo">${m.zalo ? 'Zalo: ' + esc(m.zalo) : '—'}</div>
      </span>
      <span class="member-badge">🌸 ${fc(m)}</span>
    </a>
  `).join('');
}

/* ---------------- Member detail page (view + edit) ---------------- */
let editState = null; // { memberKey, search:'', tier:'', selected:Set<flowerId> }
let editInfoState = null; // { memberKey, name, zalo, avatarDataUrl, avatarRemoved, error }

function renderMemberDetail(key){
  const app = document.getElementById('app');
  const m = state.memberByKey[key];
  if(!m){
    editState = null;
    editInfoState = null;
    app.innerHTML = notFound('thanhvien', 'Không tìm thấy thành viên này.');
    return;
  }

  if(editState && editState.memberKey === key){
    app.innerHTML = memberEditShell(m);
    wireMemberEdit(m);
    paintEditChecklist();
    return;
  }

  if(editInfoState && editInfoState.memberKey === key){
    app.innerHTML = memberInfoEditShell(m);
    wireMemberInfoEdit(m);
    return;
  }

  const flowerIds = state.flowersByMember[key] || [];
  const flowers = flowerIds.map(id => state.flowerById[id]).filter(Boolean);
  flowers.sort((a,b)=>a.name.localeCompare(b.name,'vi'));

  app.innerHTML = `
    <div class="detail-wrap">
      <a class="back-link" href="#/thanhvien" data-link>← Quay lại Thành Viên</a>
      <div class="detail-card">
        <div class="member-detail-head">
          ${avatarHTML(m)}
          <div>
            <h1>${esc(m.name)}</h1>
            <div class="sub">${m.zalo ? 'Zalo: ' + esc(m.zalo) : 'Chưa có thông tin Zalo'} · ID_Acc: ${esc(m.idAcc || '—')}</div>
          </div>
          <div class="head-btn-group">
            <button class="btn-edit btn-edit-alt" id="btnStartEditInfo">🧑‍💼 Sửa thông tin</button>
            <button class="btn-edit" id="btnStartEdit">✏️ Cập nhật hoa sở hữu</button>
          </div>
        </div>
        <div class="flower-mini-list">
          <div class="owners-title-row">
            <span class="owners-title">Hoa sở hữu (${flowers.length})</span>
          </div>
          ${flowers.length ? flowers.map(f => {
            const color = tierColor(f.tier);
            return `
            <a class="flower-mini" href="#/hoa/${encodeURIComponent(f.id)}" data-link>
              <span class="fm-swatch" style="background:${color}">🌸</span>
              <span class="fm-name">${esc(f.name)}</span>
              <span class="fm-id">${esc(f.id)}</span>
            </a>`;
          }).join('') : `<span class="no-owner-note">Thành viên này chưa sở hữu hoa nào.</span>`}
        </div>
      </div>
    </div>
  `;
  document.getElementById('btnStartEdit').addEventListener('click', async () => {
    const btn = document.getElementById('btnStartEdit');
    btn.disabled = true;
    btn.textContent = 'Đang tải…';
    // Trang có thể đã mở từ lâu — tải lại đúng dữ liệu mới nhất của riêng thành viên này
    // trước khi cho sửa, để không vô tình ghi đè lên thay đổi mới hơn của người khác.
    try{
      const { data, error } = await supabaseClient
        .from('members')
        .select('ID_Hoa_So_Huu')
        .eq('ID_Acc', toIdAccNum(m.idAcc))
        .single();
      if(!error && data){
        const freshIds = splitList(String(data.ID_Hoa_So_Huu ?? '')).filter(id => state.flowerById[id]);
        m.rawFlowerIds = freshIds;
        m.baseFlowerIds = freshIds;
        computeRelationships();
      }
    }catch(e){ /* mạng lỗi — vẫn cho sửa tiếp với dữ liệu đang có, đỡ hơn là chặn hẳn */ }
    editState = {
      memberKey: key,
      search: '',
      tier: '',
      selected: new Set(getEffectiveFlowerIds(m)),
    };
    renderMemberDetail(key);
  });
  document.getElementById('btnStartEditInfo').addEventListener('click', async () => {
    const btn = document.getElementById('btnStartEditInfo');
    btn.disabled = true;
    btn.textContent = 'Đang tải…';
    // Tải lại tên/Zalo mới nhất trước khi cho sửa, tránh ghi đè lên thay đổi mới hơn của người khác.
    try{
      const { data, error } = await supabaseClient
        .from('members')
        .select('"Tên Game", Zalo')
        .eq('ID_Acc', toIdAccNum(m.idAcc))
        .single();
      if(!error && data){
        if(data['Tên Game']) m.name = String(data['Tên Game']).trim();
        m.zalo = String(data['Zalo'] ?? '').trim();
      }
    }catch(e){ /* mạng lỗi — vẫn cho sửa tiếp với dữ liệu đang có */ }
    editInfoState = {
      memberKey: key,
      name: m.name,
      zalo: m.zalo,
      avatarDataUrl: state.avatars[key] || '',
      avatarRemoved: false,
      error: '',
    };
    renderMemberDetail(key);
  });
}

function memberInfoEditShell(m){
  const s = editInfoState;
  const previewSrc = s.avatarRemoved ? '' : s.avatarDataUrl;
  return `
    <div class="detail-wrap">
      <a class="back-link" href="#/thanhvien" data-link>← Quay lại Thành Viên</a>
      <div class="detail-card">
        <div class="member-detail-head">
          ${previewSrc
            ? `<img class="avatar avatar-img" id="infoAvatarPreview" src="${previewSrc}" alt="Xem trước ảnh đại diện">`
            : `<span class="avatar" id="infoAvatarPreview">${esc(initials(s.name || m.name))}</span>`}
          <div>
            <h1>Sửa thông tin thành viên</h1>
            <div class="sub">Cập nhật tên, Zalo và ảnh đại diện</div>
          </div>
        </div>
        <div class="edit-toolbar" style="flex-wrap:wrap;">
          <div class="select-field">
            <label>Tên trong game</label>
            <input id="infoName" type="text" value="${esc(s.name)}">
          </div>
          <div class="select-field">
            <label>Zalo</label>
            <input id="infoZalo" type="text" value="${esc(s.zalo)}">
          </div>
          <div class="select-field">
            <label>ID_Acc — không thể thay đổi</label>
            <input id="infoIdAcc" type="text" value="${esc(m.idAcc)}" disabled>
          </div>
        </div>
        <div class="edit-toolbar" style="flex-wrap:wrap;">
          <div class="select-field">
            <label>Ảnh đại diện</label>
            <input id="infoAvatarFile" type="file" accept="image/*">
          </div>
          ${previewSrc ? `<button class="btn-ghost btn-danger" id="btnRemoveAvatar" type="button">🗑️ Xóa ảnh đại diện</button>` : ''}
        </div>
        ${s.error ? `<div class="empty-state" style="padding:10px 14px;"><span class="em-ico">⚠️</span>${esc(s.error)}</div>` : ''}
        <div class="edit-actions">
          <button class="btn-primary" id="btnSaveInfo">💾 Lưu thông tin</button>
          <button class="btn-ghost" id="btnCancelInfo">Hủy</button>
        </div>
      </div>
    </div>
  `;
}

function wireMemberInfoEdit(m){
  const s = editInfoState;
  document.getElementById('infoName').addEventListener('input', e => { s.name = e.target.value; });
  document.getElementById('infoZalo').addEventListener('input', e => { s.zalo = e.target.value; });
  // ID_Acc bị vô hiệu hóa — đây là khóa định danh cố định dùng để đồng bộ Supabase, không cho sửa.

  document.getElementById('infoAvatarFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      s.avatarDataUrl = reader.result;
      s.avatarRemoved = false;
      renderMemberDetail(m.key);
    };
    reader.readAsDataURL(file);
  });

  const removeBtn = document.getElementById('btnRemoveAvatar');
  if(removeBtn){
    removeBtn.addEventListener('click', () => {
      s.avatarRemoved = true;
      s.avatarDataUrl = '';
      renderMemberDetail(m.key);
    });
  }

  document.getElementById('btnCancelInfo').addEventListener('click', () => {
    editInfoState = null;
    renderMemberDetail(m.key);
  });

  document.getElementById('btnSaveInfo').addEventListener('click', async () => {
    const name = s.name.trim();
    if(!name){
      s.error = 'Vui lòng nhập tên trong game.';
      renderMemberDetail(m.key);
      return;
    }
    const zalo = s.zalo.trim();

    const saveBtn = document.getElementById('btnSaveInfo');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu…';

    const { error } = await supabaseClient
      .from('members')
      .update({ 'Tên Game': name, Zalo: zalo })
      .eq('ID_Acc', toIdAccNum(m.idAcc));

    if(error){
      console.error(error);
      s.error = 'Lưu thất bại: ' + (error.message || '');
      renderMemberDetail(m.key);
      return;
    }

    m.name = name;
    m.zalo = zalo;

    if(s.avatarRemoved){
      delete state.avatars[m.key];
    } else if(s.avatarDataUrl){
      state.avatars[m.key] = s.avatarDataUrl;
    }
    saveAvatars();

    editInfoState = null;
    renderMemberDetail(m.key);
  });
}

function memberEditShell(m){
  return `
    <div class="detail-wrap">
      <a class="back-link" href="#/thanhvien" data-link>← Quay lại Thành Viên</a>
      <div class="detail-card">
        <div class="member-detail-head">
          <span class="avatar">${esc(initials(m.name))}</span>
          <div>
            <h1>${esc(m.name)}</h1>
            <div class="sub">Đang chỉnh sửa hoa sở hữu — chọn/bỏ chọn rồi bấm Lưu</div>
          </div>
        </div>
        <div class="edit-toolbar">
          <div class="search-box">
            <span>🔎</span>
            <input id="editSearch" type="text" placeholder="Tìm hoa để đánh dấu…">
          </div>
          <div class="tier-chips" id="editTierChips">
            ${chipHTML('', 'Tất cả', '#C4923F')}
            ${TIER_ORDER.map(t => chipHTML(t, t, tierColor(t))).join('')}
          </div>
          <span class="edit-selected-count" id="editSelectedCount"></span>
        </div>
        <div class="edit-checklist" id="editChecklist"></div>
        <div class="edit-actions">
          <button class="btn-primary" id="btnSaveEdit">💾 Lưu thay đổi</button>
          <button class="btn-ghost" id="btnCancelEdit">Hủy</button>
        </div>
      </div>
    </div>
  `;
}

function wireMemberEdit(m){
  document.getElementById('editSearch').addEventListener('input', e => {
    editState.search = e.target.value; paintEditChecklist();
  });
  document.getElementById('editTierChips').addEventListener('click', e => {
    const chip = e.target.closest('.tier-chip');
    if(!chip) return;
    editState.tier = chip.dataset.tier;
    paintEditChecklist();
    document.querySelectorAll('#editTierChips .tier-chip').forEach(c=>{
      const active = c.dataset.tier === editState.tier;
      c.classList.toggle('active', active);
      c.style.background = active ? c.style.getPropertyValue('--c') : '';
    });
  });
  document.getElementById('btnSaveEdit').addEventListener('click', async () => {
    const flowerIds = Array.from(editState.selected);

    const saveBtn = document.getElementById('btnSaveEdit');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu…';

    let error;
    try{
      const res = await supabaseClient
        .from('members')
        .update({ ID_Hoa_So_Huu: flowerIds.join(',') })
        .eq('ID_Acc', toIdAccNum(m.idAcc));
      error = res.error;
    }catch(networkErr){
      error = networkErr;
    }

    if(error){
      console.error(error);
      alert('Lưu thất bại (kiểm tra lại kết nối mạng rồi thử lại): ' + (error.message || String(error)));
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Lưu thay đổi';
      return;
    }

    m.rawFlowerIds = flowerIds;
    m.baseFlowerIds = flowerIds;

    computeRelationships();
    editState = null;
    renderMemberDetail(m.key);
  });
  document.getElementById('btnCancelEdit').addEventListener('click', () => {
    editState = null;
    renderMemberDetail(m.key);
  });
}

function paintEditChecklist(){
  const box = document.getElementById('editChecklist');
  const q = editState.search.trim().toLowerCase();
  let list = state.flowers.slice();
  if(q) list = list.filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  if(editState.tier) list = list.filter(f => f.tier === editState.tier);
  list.sort((a,b)=>a.id.localeCompare(b.id));

  document.getElementById('editSelectedCount').textContent = `${editState.selected.size} hoa đã chọn`;

  if(!list.length){
    box.innerHTML = `<div class="empty-state"><span class="em-ico">🥀</span>Không tìm thấy hoa nào phù hợp.</div>`;
    return;
  }

  box.innerHTML = list.map(f => {
    const color = tierColor(f.tier);
    const checked = editState.selected.has(f.id);
    return `
    <label class="edit-row ${checked ? 'checked':''}">
      <input type="checkbox" data-fid="${esc(f.id)}" ${checked ? 'checked':''}>
      <span class="fm-swatch" style="background:${color}">🌸</span>
      <span class="fm-name">${esc(f.name)}</span>
      <span class="fm-id">${esc(f.id)}</span>
    </label>`;
  }).join('');

  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      const fid = e.target.dataset.fid;
      if(e.target.checked) editState.selected.add(fid);
      else editState.selected.delete(fid);
      e.target.closest('.edit-row').classList.toggle('checked', e.target.checked);
      document.getElementById('editSelectedCount').textContent = `${editState.selected.size} hoa đã chọn`;
    });
  });
}

function notFound(back, msg){
  return `<div class="empty-state"><span class="em-ico">⚠️</span>${esc(msg)}<br><br>
    <a class="back-link" href="#/${back}" data-link>← Quay lại</a></div>`;
}

/* ---------------- init ---------------- */
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
