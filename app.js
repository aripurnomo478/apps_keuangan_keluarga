const DB_NAME = 'BukuKasKeluargaDB';
const DB_VERSION = 1;
let db;
let chartPengeluaranInstance = null;
const DEFAULT_PASSWORD = '1234';

// List Default Pos Uang / Rekening / E-Wallet
const defaultSumberDana = ['Kas Tunai', 'Bank BCA', 'Bank BNI', 'Bank BTN', 'Bank BSI', 'GoPay', 'DANA', 'OVO'];

// Kategori Default
const defaultKategori = {
  pemasukan: ['Gaji', 'Usaha/Bisnis', 'Investasi', 'Bonus / THR', 'Lainnya'],
  pengeluaran: ['Belanja Harian', 'Tagihan & Rutin', 'Pendidikan', 'Kesehatan', 'Hiburan', 'Cicilan / Kredit', 'Lainnya']
};

let opsiSumberDana = loadSumberDana();
let opsiKategori = loadKategori();
let anggaranKategori = loadAnggaran();
let editKategoriMap = {}; // Penyimpanan temporary pengeditan nama kategori di Pagu

// 1. SISTEM LOGIN & AUTHENTICATION
document.getElementById('formLogin').addEventListener('submit', (e) => {
  e.preventDefault();
  const inputPass = document.getElementById('inputPassword').value;
  const loginError = document.getElementById('loginError');

  if (inputPass === DEFAULT_PASSWORD) {
    sessionStorage.setItem('isLoggedIn', 'true');
    document.getElementById('screenLogin').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');
    loginError.classList.add('hidden');
    initDB();
  } else {
    loginError.classList.remove('hidden');
  }
});

function checkAuth() {
  if (sessionStorage.getItem('isLoggedIn') === 'true') {
    document.getElementById('screenLogin').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');
    initDB();
  }
}

function logout() {
  sessionStorage.removeItem('isLoggedIn');
  window.location.reload();
}

// 2. NAVIGASI TAB SPAs
function switchTab(tabName) {
  const tabs = ['dashboard', 'transaksi', 'anggaran', 'preview'];
  tabs.forEach(t => {
    const elTab = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const elBtn = document.getElementById(`nav${t.charAt(0).toUpperCase() + t.slice(1)}`);
    
    if (t === tabName) {
      elTab.classList.remove('hidden');
      elBtn.className = "nav-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-white text-blue-600 shadow-sm";
    } else {
      elTab.classList.add('hidden');
      elBtn.className = "nav-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:bg-blue-600 text-white";
    }
  });

  if (tabName === 'preview') {
    renderPreviewTable();
  }
}

// LocalStorage Handlers
function loadSumberDana() {
  const saved = localStorage.getItem('buku_kas_sumber_dana');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) { console.error(e); }
  }
  localStorage.setItem('buku_kas_sumber_dana', JSON.stringify(defaultSumberDana));
  return JSON.parse(JSON.stringify(defaultSumberDana));
}

function saveSumberDana() {
  localStorage.setItem('buku_kas_sumber_dana', JSON.stringify(opsiSumberDana));
  updateSumberDanaOptions();
  tampilkanTransaksi();
}

function loadKategori() {
  const saved = localStorage.getItem('buku_kas_kategori');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) { console.error(e); }
  }
  localStorage.setItem('buku_kas_kategori', JSON.stringify(defaultKategori));
  return JSON.parse(JSON.stringify(defaultKategori));
}

function saveKategori() {
  localStorage.setItem('buku_kas_kategori', JSON.stringify(opsiKategori));
  updateKategoriOptions();
  tampilkanTransaksi();
}

function loadAnggaran() {
  const saved = localStorage.getItem('buku_kas_anggaran');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) { console.error(e); }
  }
  return {};
}

function saveAnggaran() {
  localStorage.setItem('buku_kas_anggaran', JSON.stringify(anggaranKategori));
  tampilkanTransaksi();
}

// FITUR BACKUP & RESTORE DATA (JSON)
function eksporBackupData() {
  const tx = db.transaction('transaksi', 'readonly');
  tx.objectStore('transaksi').getAll().onsuccess = (e) => {
    const transaksiData = e.target.result;
    const backupPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      sumberDana: loadSumberDana(),
      kategori: loadKategori(),
      anggaran: loadAnggaran(),
      transaksi: transaksiData
    };

    const jsonStr = JSON.stringify(backupPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_KasKeluarga_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
}

function imporRestoreData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.transaksi || !Array.isArray(payload.transaksi)) {
        alert('Format file backup tidak valid!');
        return;
      }

      if (!confirm(`Apakah Anda yakin ingin mengimpor ${payload.transaksi.length} data transaksi? Data lama akan ditimpa.`)) {
        return;
      }

      if (payload.sumberDana) localStorage.setItem('buku_kas_sumber_dana', JSON.stringify(payload.sumberDana));
      if (payload.kategori) localStorage.setItem('buku_kas_kategori', JSON.stringify(payload.kategori));
      if (payload.anggaran) localStorage.setItem('buku_kas_anggaran', JSON.stringify(payload.anggaran));

      opsiSumberDana = loadSumberDana();
      opsiKategori = loadKategori();
      anggaranKategori = loadAnggaran();

      const tx = db.transaction('transaksi', 'readwrite');
      const store = tx.objectStore('transaksi');
      store.clear().onsuccess = () => {
        let count = 0;
        if (payload.transaksi.length === 0) {
          updateSumberDanaOptions();
          updateKategoriOptions();
          tampilkanTransaksi();
          alert('Restore berhasil diselesaikan.');
          return;
        }

        payload.transaksi.forEach((item) => {
          const newItem = { ...item };
          delete newItem.id;
          store.add(newItem).onsuccess = () => {
            count++;
            if (count === payload.transaksi.length) {
              updateSumberDanaOptions();
              updateKategoriOptions();
              tampilkanTransaksi();
              alert(`Berhasil memulihkan ${count} data transaksi!`);
            }
          };
        });
      };
    } catch (err) {
      alert('Gagal membaca file backup JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Update Opsi Dropdown Pos Uang / Rekening
function updateSumberDanaOptions() {
  const html = opsiSumberDana.map(s => `<option value="${s}">${s}</option>`).join('');
  document.getElementById('sumberDana').innerHTML = html;
  document.getElementById('tujuanDana').innerHTML = html;
  document.getElementById('editSumberDana').innerHTML = html;
  document.getElementById('editTujuanDana').innerHTML = html;
}

// Update Layout Form Tambah berdasarkan Jenis Transaksi
function updateFormJenis() {
  const jenis = document.getElementById('jenis').value;
  const labelSumber = document.getElementById('labelSumberDana');
  const divTujuan = document.getElementById('divTujuanDana');
  const divKategori = document.getElementById('divKategori');

  if (jenis === 'transfer') {
    labelSumber.innerText = "Dari Rekening / Pos Asal";
    divTujuan.classList.remove('hidden');
    divKategori.classList.add('hidden');
  } else {
    divTujuan.classList.add('hidden');
    divKategori.classList.remove('hidden');
    
    if (jenis === 'pemasukan') {
      labelSumber.innerText = "Rekening Penerima (Masuk Ke)";
    } else {
      labelSumber.innerText = "Diambil Dari (Pos / Rekening)";
    }
  }

  updateKategoriOptions();
}

// MODAL MANAJEMEN POS UANG / REKENING
function toggleModalSumberDana(show) {
  document.getElementById('modalSumberDana').classList.toggle('hidden', !show);
  if (show) renderDaftarSumberDana();
}

function renderDaftarSumberDana() {
  const container = document.getElementById('listSumberDanaContainer');
  container.innerHTML = opsiSumberDana.map((item, index) => `
    <div class="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
      <span class="text-xs font-medium text-slate-700">${item}</span>
      <button onclick="hapusSumberDana(${index})" class="text-rose-500 hover:text-rose-700 text-xs font-bold px-2">✕</button>
    </div>
  `).join('');
}

function tambahSumberDanaBaru() {
  const input = document.getElementById('inputSumberDanaBaru');
  const nama = input.value.trim();
  if (!nama || opsiSumberDana.includes(nama)) return;
  opsiSumberDana.push(nama);
  saveSumberDana();
  input.value = '';
  renderDaftarSumberDana();
}

function hapusSumberDana(index) {
  if (opsiSumberDana.length <= 1) return;
  if (confirm('Hapus pos uang/rekening ini?')) {
    opsiSumberDana.splice(index, 1);
    saveSumberDana();
    renderDaftarSumberDana();
  }
}

// Modal Handlers Edit Transaksi
function toggleModalEdit(show) {
  document.getElementById('modalEditTransaksi').classList.toggle('hidden', !show);
}

function updateEditJenisLayout() {
  const jenis = document.getElementById('editJenis').value;
  const divTujuan = document.getElementById('divEditTujuanDana');
  const divKategori = document.getElementById('divEditKategori');
  const labelSumber = document.getElementById('editLabelSumber');

  if (jenis === 'transfer') {
    labelSumber.innerText = "Dari Rekening / Pos Asal";
    divTujuan.classList.remove('hidden');
    divKategori.classList.add('hidden');
  } else {
    divTujuan.classList.add('hidden');
    divKategori.classList.remove('hidden');
    labelSumber.innerText = jenis === 'pemasukan' ? "Rekening Penerima (Masuk Ke)" : "Diambil Dari (Pos / Rekening)";
  }
  updateEditKategoriOptions();
}

function updateEditKategoriOptions() {
  const editJenis = document.getElementById('editJenis').value;
  if (editJenis === 'transfer') return;
  const list = opsiKategori[editJenis] || [];
  document.getElementById('editKategori').innerHTML = list
    .map(kat => `<option value="${kat}">${kat}</option>`).join('');
}

function editTransaksi(id) {
  const tx = db.transaction('transaksi', 'readonly');
  const store = tx.objectStore('transaksi');
  const request = store.get(id);

  request.onsuccess = () => {
    const item = request.result;
    if (!item) return;

    document.getElementById('editId').value = item.id;
    document.getElementById('editTanggal').value = item.tanggal;
    document.getElementById('editJenis').value = item.jenis;
    document.getElementById('editSumberDana').value = item.sumberDana || 'Kas Tunai';
    document.getElementById('editTujuanDana').value = item.tujuanDana || 'Bank BCA';
    
    updateEditJenisLayout();
    
    if (item.jenis !== 'transfer') {
      document.getElementById('editKategori').value = item.kategori;
    }

    document.getElementById('editNominal').value = item.nominal;
    document.getElementById('editCatatan').value = item.catatan || '';
    toggleModalEdit(true);
  };
}

document.getElementById('formEditTransaksi').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = Number(document.getElementById('editId').value);
  const jenis = document.getElementById('editJenis').value;

  const updated = {
    id: id,
    tanggal: document.getElementById('editTanggal').value,
    jenis: jenis,
    sumberDana: document.getElementById('editSumberDana').value,
    tujuanDana: jenis === 'transfer' ? document.getElementById('editTujuanDana').value : null,
    kategori: jenis === 'transfer' ? 'Pemindahbukuan' : document.getElementById('editKategori').value,
    nominal: Number(document.getElementById('editNominal').value),
    catatan: document.getElementById('editCatatan').value.trim(),
    updatedAt: new Date().toISOString()
  };

  const tx = db.transaction('transaksi', 'readwrite');
  const store = tx.objectStore('transaksi');
  store.put(updated).onsuccess = () => {
    toggleModalEdit(false);
    tampilkanTransaksi();
  };
});

// MODAL MANAJEMEN KATEGORI (UMUM)
let activeTabKategori = 'pengeluaran';

function toggleModalKategori(show) {
  document.getElementById('modalKategori').classList.toggle('hidden', !show);
  if (show) renderDaftarKategori();
}

function switchTabKategori(jenis) {
  activeTabKategori = jenis;
  document.getElementById('tabKatPengeluaran').className = jenis === 'pengeluaran' ? "flex-1 py-2 text-center border-b-2 border-blue-600 text-blue-600 font-semibold" : "flex-1 py-2 text-center border-b-2 border-transparent text-slate-500";
  document.getElementById('tabKatPemasukan').className = jenis === 'pemasukan' ? "flex-1 py-2 text-center border-b-2 border-blue-600 text-blue-600 font-semibold" : "flex-1 py-2 text-center border-b-2 border-transparent text-slate-500";
  renderDaftarKategori();
}

function renderDaftarKategori() {
  const container = document.getElementById('listKategoriContainer');
  const list = opsiKategori[activeTabKategori] || [];
  container.innerHTML = list.map((kat, index) => `
    <div class="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
      <span class="text-xs font-medium text-slate-700">${kat}</span>
      <button onclick="hapusKategori('${activeTabKategori}', ${index})" class="text-rose-500 hover:text-rose-700 text-xs font-bold px-2">✕</button>
    </div>
  `).join('');
}

function tambahKategoriBaru() {
  const input = document.getElementById('inputKategoriBaru');
  const nama = input.value.trim();
  if (!nama || opsiKategori[activeTabKategori].includes(nama)) return;
  opsiKategori[activeTabKategori].push(nama);
  saveKategori();
  input.value = '';
  renderDaftarKategori();
}

function hapusKategori(jenis, index) {
  if (opsiKategori[jenis].length <= 1) return;
  if (confirm('Hapus kategori ini?')) {
    opsiKategori[jenis].splice(index, 1);
    saveKategori();
    renderDaftarKategori();
  }
}

// MODAL MANAJEMEN PAGU ANGGARAN (DENGAN EDIT & TAMBAH URAIAN DIRECT)
function toggleModalAnggaran(show) {
  document.getElementById('modalAnggaran').classList.toggle('hidden', !show);
  if (show) renderFormAnggaran();
}

function renderFormAnggaran() {
  const container = document.getElementById('listFormAnggaran');
  const list = opsiKategori.pengeluaran || [];
  
  editKategoriMap = {};

  container.innerHTML = list.map((kat, index) => {
    editKategoriMap[index] = kat;
    return `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
        <div class="flex items-center gap-2">
          <input type="text" 
                 id="namaKat_${index}" 
                 value="${kat}" 
                 onchange="updateNamaKategoriTemp(${index}, this.value)"
                 class="w-full px-2.5 py-1 border rounded-lg text-xs font-semibold text-slate-700 bg-white focus:ring-1 focus:ring-blue-500">
          <button type="button" 
                  onclick="hapusKategoriAnggaranDirect(${index})" 
                  class="text-rose-500 hover:text-rose-700 text-xs font-bold px-1.5 py-1 rounded hover:bg-rose-50" title="Hapus Uraian">✕</button>
        </div>
        <div>
          <input type="number" 
                 data-index="${index}" 
                 value="${anggaranKategori[kat] || ''}" 
                 placeholder="Nominal Pagu (0 = Tanpa Pagu)" 
                 class="input-anggaran-item w-full px-3 py-1.5 border rounded-lg text-xs font-medium bg-white">
        </div>
      </div>
    `;
  }).join('');
}

function updateNamaKategoriTemp(index, val) {
  const namaBaru = val.trim();
  if (namaBaru) {
    editKategoriMap[index] = namaBaru;
  }
}

function tambahUraianAnggaranBaru() {
  const input = document.getElementById('inputUraianAnggaranBaru');
  const namaBaru = input.value.trim();

  if (!namaBaru) return;
  if (opsiKategori.pengeluaran.includes(namaBaru)) {
    alert('Uraian pengeluaran ini sudah ada!');
    return;
  }

  opsiKategori.pengeluaran.push(namaBaru);
  saveKategori();
  input.value = '';
  renderFormAnggaran();
}

function hapusKategoriAnggaranDirect(index) {
  if (opsiKategori.pengeluaran.length <= 1) {
    alert('Minimal harus ada satu uraian pengeluaran!');
    return;
  }
  
  const namaKat = opsiKategori.pengeluaran[index];
  if (confirm(`Hapus uraian pengeluaran "${namaKat}"?`)) {
    delete anggaranKategori[namaKat];
    opsiKategori.pengeluaran.splice(index, 1);
    saveKategori();
    saveAnggaran();
    renderFormAnggaran();
  }
}

function simpanAnggaran() {
  const newAnggaran = {};
  const listLama = [...opsiKategori.pengeluaran];

  document.querySelectorAll('.input-anggaran-item').forEach(input => {
    const idx = input.getAttribute('data-index');
    const namaLama = listLama[idx];
    const namaBaru = editKategoriMap[idx] || namaLama;
    const val = Number(input.value);

    opsiKategori.pengeluaran[idx] = namaBaru;

    if (val > 0) {
      newAnggaran[namaBaru] = val;
    }
  });

  anggaranKategori = newAnggaran;
  saveKategori();
  saveAnggaran();
  toggleModalAnggaran(false);
}

// Inisialisasi Database
function initDB() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('transaksi')) {
      const store = db.createObjectStore('transaksi', { keyPath: 'id', autoIncrement: true });
      store.createIndex('idx_tanggal', 'tanggal', { unique: false });
    }
  };
  request.onsuccess = (e) => {
    db = e.target.result;
    initFilterTahun();
    document.getElementById('tanggal').valueAsDate = new Date();
    updateSumberDanaOptions();
    updateKategoriOptions();
    tampilkanTransaksi();
  };
}

function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
}

function formatTanggal(strTanggal) {
  if (!strTanggal) return '-';
  const [year, month, day] = strTanggal.split('-');
  return `${day}/${month}/${year}`;
}

function updateKategoriOptions() {
  const jenis = document.getElementById('jenis').value;
  if (jenis === 'transfer') return;
  document.getElementById('kategori').innerHTML = (opsiKategori[jenis] || [])
    .map(kat => `<option value="${kat}">${kat}</option>`).join('');
}

// Tambah Transaksi
document.getElementById('formTransaksi').addEventListener('submit', (e) => {
  e.preventDefault();
  const jenis = document.getElementById('jenis').value;
  const sumber = document.getElementById('sumberDana').value;
  const tujuan = document.getElementById('tujuanDana').value;

  if (jenis === 'transfer' && sumber === tujuan) {
    alert('Rekening asal dan rekening tujuan tidak boleh sama!');
    return;
  }

  const transaksiBaru = {
    tanggal: document.getElementById('tanggal').value,
    jenis: jenis,
    sumberDana: sumber,
    tujuanDana: jenis === 'transfer' ? tujuan : null,
    kategori: jenis === 'transfer' ? 'Pemindahbukuan' : document.getElementById('kategori').value,
    nominal: Number(document.getElementById('nominal').value),
    catatan: document.getElementById('catatan').value.trim(),
    createdAt: new Date().toISOString()
  };

  const tx = db.transaction('transaksi', 'readwrite');
  tx.objectStore('transaksi').add(transaksiBaru).onsuccess = () => {
    document.getElementById('formTransaksi').reset();
    document.getElementById('tanggal').valueAsDate = new Date();
    updateFormJenis();
    tampilkanTransaksi();
  };
});

// Tampilkan Transaksi & Hitung Saldo Autogenerated
function tampilkanTransaksi() {
  const tx = db.transaction('transaksi', 'readonly');
  tx.objectStore('transaksi').getAll().onsuccess = (e) => {
    const data = e.target.result;
    data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || a.id - b.id);

    let akumulasiSaldo = 0;
    const saldoRekeningMap = {};
    opsiSumberDana.forEach(s => saldoRekeningMap[s] = 0);

    data.forEach(item => {
      const posAsal = item.sumberDana || 'Kas Tunai';
      const posTujuan = item.tujuanDana;

      if (!(posAsal in saldoRekeningMap)) saldoRekeningMap[posAsal] = 0;

      if (item.jenis === 'pemasukan') {
        akumulasiSaldo += item.nominal;
        saldoRekeningMap[posAsal] += item.nominal;
      } else if (item.jenis === 'pengeluaran') {
        akumulasiSaldo -= item.nominal;
        saldoRekeningMap[posAsal] -= item.nominal;
      } else if (item.jenis === 'transfer') {
        if (posTujuan && !(posTujuan in saldoRekeningMap)) saldoRekeningMap[posTujuan] = 0;
        saldoRekeningMap[posAsal] -= item.nominal;
        if (posTujuan) saldoRekeningMap[posTujuan] += item.nominal;
      }
      item.saldoBerjalan = akumulasiSaldo;
    });

    const bulanPilihan = document.getElementById('filterBulan').value;
    const tahunPilihan = document.getElementById('filterTahun').value;

    const filteredData = data.filter(item => {
      if (!item.tanggal) return true;
      const [yr, mo] = item.tanggal.split('-');
      return ((bulanPilihan === 'semua') || (mo === bulanPilihan)) &&
             ((tahunPilihan === 'semua') || (yr === tahunPilihan));
    });

    let totalPemasukan = 0;
    let totalPengeluaran = 0;
    const rekapPengeluaran = {};
    const rekapPemasukan = {};

    const tabelBody = document.getElementById('tabelBody');
    tabelBody.innerHTML = '';

    if (filteredData.length === 0) {
      tabelBody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">Tidak ada transaksi.</td></tr>`;
    } else {
      filteredData.forEach((item) => {
        let debetText = '-', kreditText = '-';
        let posText = `<span class="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200">${item.sumberDana || 'Kas Tunai'}</span>`;

        if (item.jenis === 'pemasukan') {
          totalPemasukan += item.nominal;
          debetText = formatRupiah(item.nominal);
          rekapPemasukan[item.kategori] = (rekapPemasukan[item.kategori] || 0) + item.nominal;
        } else if (item.jenis === 'pengeluaran') {
          totalPengeluaran += item.nominal;
          kreditText = formatRupiah(item.nominal);
          rekapPengeluaran[item.kategori] = (rekapPengeluaran[item.kategori] || 0) + item.nominal;
        } else if (item.jenis === 'transfer') {
          posText = `<span class="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-amber-50 text-amber-700 border border-amber-200">${item.sumberDana} ➔ ${item.tujuanDana}</span>`;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors border-b border-slate-100';
        tr.innerHTML = `
          <td class="py-3 px-3 text-slate-600 whitespace-nowrap">${formatTanggal(item.tanggal)}</td>
          <td class="py-3 px-3 whitespace-nowrap">${posText}</td>
          <td class="py-3 px-3">
            <span class="font-medium text-slate-800">${item.jenis === 'transfer' ? '🔄 Pemindahbukuan' : item.kategori}</span>
            ${item.catatan ? `<p class="text-xs text-slate-400">${item.catatan}</p>` : ''}
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap text-emerald-600 font-medium">${debetText}</td>
          <td class="py-3 px-3 text-right whitespace-nowrap text-rose-600 font-medium">${kreditText}</td>
          <td class="py-3 px-3 text-right whitespace-nowrap font-semibold text-slate-800">${formatRupiah(item.saldoBerjalan)}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap space-x-2">
            <button onclick="editTransaksi(${item.id})" class="text-xs text-blue-600 font-medium">Edit</button>
            <button onclick="hapusTransaksi(${item.id})" class="text-xs text-rose-500 font-medium">Hapus</button>
          </td>
        `;
        tabelBody.appendChild(tr);
      });
    }

    // Update Dashboard Cards
    document.getElementById('dashTotalPemasukan').innerText = formatRupiah(totalPemasukan);
    document.getElementById('dashTotalPengeluaran').innerText = formatRupiah(totalPengeluaran);
    document.getElementById('dashSisaSaldo').innerText = formatRupiah(akumulasiSaldo);
    document.getElementById('totalData').innerText = `${filteredData.length} Data Ditampilkan`;

    renderSaldoRekeningCards(saldoRekeningMap);
    renderChart(totalPemasukan, totalPengeluaran, rekapPemasukan, rekapPengeluaran);
    renderPaguViews(rekapPengeluaran);
  };
}

// Render Cards Saldo per Rekening
function renderSaldoRekeningCards(saldoMap) {
  const container = document.getElementById('containerSaldoRekening');
  let html = '';

  for (const [pos, sisa] of Object.entries(saldoMap)) {
    let colorClass = sisa < 0 ? 'text-rose-600' : 'text-slate-800';
    html += `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
        <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">${pos}</p>
        <p class="text-base font-bold mt-1 ${colorClass}">${formatRupiah(sisa)}</p>
      </div>
    `;
  }
  container.innerHTML = html;
}

// Render Pagu Views + Summary Total Pagu Block
function renderPaguViews(realisasiPengeluaran) {
  const containerDash = document.getElementById('dashContainerAnggaran');
  const containerFull = document.getElementById('containerAnggaranLengkap');
  const containerSummaryTotal = document.getElementById('containerSummaryPaguTotal');
  const targetKategori = opsiKategori.pengeluaran || [];

  let htmlDash = '', htmlFull = '';
  let totalPagu = 0, totalRealisasi = 0;

  targetKategori.forEach(kat => {
    const pagu = anggaranKategori[kat] || 0;
    if (pagu > 0) {
      const realisasi = realisasiPengeluaran[kat] || 0;
      const sisa = pagu - realisasi;
      const persentase = Math.round((realisasi / pagu) * 100);

      totalPagu += pagu;
      totalRealisasi += realisasi;

      let barColor = 'bg-emerald-500', statusClass = 'text-emerald-600 font-semibold';
      if (sisa < 0) { barColor = 'bg-rose-500'; statusClass = 'text-rose-600 font-bold'; }
      else if (persentase >= 80) { barColor = 'bg-amber-500'; statusClass = 'text-amber-600 font-semibold'; }

      htmlDash += `
        <div class="space-y-1">
          <div class="flex justify-between text-xs">
            <span class="font-medium text-slate-700">${kat}</span>
            <span class="${statusClass}">${persentase}%</span>
          </div>
          <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div class="${barColor} h-full" style="width: ${Math.min(persentase, 100)}%"></div>
          </div>
        </div>
      `;

      htmlFull += `
        <div class="p-4 bg-slate-50 rounded-2xl border space-y-3">
          <div class="flex justify-between items-center">
            <span class="font-bold text-slate-800 text-sm">${kat}</span>
            <span class="text-xs px-2 py-0.5 rounded ${statusClass} bg-white border">${persentase}% Realisasi</span>
          </div>
          <div class="grid grid-cols-3 gap-1 text-xs py-2 border-y">
            <div><p class="text-[10px] text-slate-400">Pagu</p><p class="font-semibold">${formatRupiah(pagu)}</p></div>
            <div class="text-center"><p class="text-[10px] text-slate-400">Realisasi</p><p class="font-semibold text-rose-600">${formatRupiah(realisasi)}</p></div>
            <div class="text-right"><p class="text-[10px] text-slate-400">Sisa</p><p class="font-semibold ${sisa < 0 ? 'text-rose-600' : 'text-slate-800'}">${formatRupiah(sisa)}</p></div>
          </div>
          <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
            <div class="${barColor} h-full" style="width: ${Math.min(persentase, 100)}%"></div>
          </div>
        </div>
      `;
    }
  });

  const totalSisa = totalPagu - totalRealisasi;
  const totalPersentase = totalPagu > 0 ? Math.round((totalRealisasi / totalPagu) * 100) : 0;

  let statusBg = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (totalSisa < 0) statusBg = 'bg-rose-50 text-rose-700 border-rose-200';
  else if (totalPersentase >= 80) statusBg = 'bg-amber-50 text-amber-700 border-amber-200';

  if (containerSummaryTotal) {
    containerSummaryTotal.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
        <div class="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-sm">
          <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Total Pagu Anggaran</p>
          <p class="text-lg font-bold text-slate-800 mt-1">${formatRupiah(totalPagu)}</p>
        </div>
        <div class="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-sm">
          <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Total Realisasi</p>
          <p class="text-lg font-bold text-rose-600 mt-1">${formatRupiah(totalRealisasi)}</p>
        </div>
        <div class="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-sm">
          <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Total Sisa Dana</p>
          <p class="text-lg font-bold ${totalSisa < 0 ? 'text-rose-600' : 'text-emerald-600'} mt-1">${formatRupiah(totalSisa)}</p>
        </div>
        <div class="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <p class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">% Realisasi Total</p>
          <div class="flex items-center justify-between mt-1">
            <span class="text-xl font-extrabold text-slate-800">${totalPersentase}%</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold border ${statusBg}">${totalPersentase}% Terpakai</span>
          </div>
        </div>
      </div>
    `;
  }

  containerDash.innerHTML = htmlDash || `<p class="text-xs text-slate-400 text-center py-4">Belum ada pagu diatur.</p>`;
  containerFull.innerHTML = htmlFull || `<p class="text-xs text-slate-400 text-center py-8 col-span-3">Belum ada pagu diatur.</p>`;
}

// Render Grafik
function renderChart(totalPemasukan, totalPengeluaran, rekapPemasukan, rekapPengeluaran) {
  const ctx = document.getElementById('chartPengeluaranCanvas').getContext('2d');
  const tipeGrafik = document.getElementById('pilihanGrafik').value;

  if (chartPengeluaranInstance) chartPengeluaranInstance.destroy();

  let labels = [], values = [], palette = [];
  if (tipeGrafik === 'perbandingan') {
    labels = ['Debet (Pemasukan)', 'Kredit (Pengeluaran)'];
    values = [totalPemasukan, totalPengeluaran];
    palette = ['#10b981', '#ef4444'];
  } else if (tipeGrafik === 'pengeluaran') {
    labels = Object.keys(rekapPengeluaran);
    values = Object.values(rekapPengeluaran);
    palette = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
  } else {
    labels = Object.keys(rekapPemasukan);
    values = Object.values(rekapPemasukan);
    palette = ['#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6'];
  }

  if (values.length === 0 || values.reduce((a, b) => a + b, 0) === 0) {
    chartPengeluaranInstance = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Belum Ada Data'], datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
    return;
  }

  chartPengeluaranInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: palette, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

// Render Preview Table
function renderPreviewTable() {
  const tx = db.transaction('transaksi', 'readonly');
  tx.objectStore('transaksi').getAll().onsuccess = (e) => {
    const data = e.target.result;
    data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || a.id - b.id);

    let runSaldo = 0, totDebet = 0, totKredit = 0;
    const tbody = document.getElementById('previewTabelBody');
    tbody.innerHTML = '';

    const bulanPilihan = document.getElementById('filterBulan').value;
    const tahunPilihan = document.getElementById('filterTahun').value;

    const filtered = data.filter(item => {
      if (!item.tanggal) return true;
      const [yr, mo] = item.tanggal.split('-');
      return ((bulanPilihan === 'semua') || (mo === bulanPilihan)) &&
             ((tahunPilihan === 'semua') || (yr === tahunPilihan));
    });

    document.getElementById('previewPeriodeText').innerText = `Periode: Bulan ${bulanPilihan} - Tahun ${tahunPilihan}`;
    document.getElementById('previewCetakDate').innerText = new Date().toLocaleDateString('id-ID', { dateStyle: 'full' });

    filtered.forEach(item => {
      let debet = 0, kredit = 0;
      let posInfo = item.sumberDana || 'Kas Tunai';

      if (item.jenis === 'pemasukan') {
        debet = item.nominal;
        runSaldo += debet;
        totDebet += debet;
      } else if (item.jenis === 'pengeluaran') {
        kredit = item.nominal;
        runSaldo -= kredit;
        totKredit += kredit;
      } else if (item.jenis === 'transfer') {
        posInfo = `${item.sumberDana} ➔ ${item.tujuanDana}`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-2.5 px-3 whitespace-nowrap">${formatTanggal(item.tanggal)}</td>
        <td class="py-2.5 px-3 font-semibold text-blue-700">${posInfo}</td>
        <td class="py-2.5 px-3 font-semibold">${item.jenis === 'transfer' ? '🔄 Transfer Internal' : item.kategori}</td>
        <td class="py-2.5 px-3 text-slate-500">${item.catatan || '-'}</td>
        <td class="py-2.5 px-3 text-right text-emerald-600 font-medium">${debet ? formatRupiah(debet) : '-'}</td>
        <td class="py-2.5 px-3 text-right text-rose-600 font-medium">${kredit ? formatRupiah(kredit) : '-'}</td>
        <td class="py-2.5 px-3 text-right font-bold">${formatRupiah(runSaldo)}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('previewTotalDebet').innerText = formatRupiah(totDebet);
    document.getElementById('previewTotalKredit').innerText = formatRupiah(totKredit);
    document.getElementById('previewSaldoAkhir').innerText = formatRupiah(runSaldo);
  };
}

// 3. EKSPOR LAPORAN TO PDF
function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const bulan = document.getElementById('filterBulan').value;
  const tahun = document.getElementById('filterTahun').value;

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('LAPORAN BUKU KAS KELUARGA', 105, 18, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Periode: ${bulan === 'semua' ? 'Semua Bulan' : 'Bulan ' + bulan} ${tahun}`, 105, 25, { align: 'center' });
  doc.text(`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`, 105, 30, { align: 'center' });

  doc.setLineWidth(0.5);
  doc.line(14, 34, 196, 34);

  const tx = db.transaction('transaksi', 'readonly');
  tx.objectStore('transaksi').getAll().onsuccess = (e) => {
    const data = e.target.result;
    data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || a.id - b.id);

    let runSaldo = 0, totDebet = 0, totKredit = 0;
    const rows = [];

    const filtered = data.filter(item => {
      if (!item.tanggal) return true;
      const [yr, mo] = item.tanggal.split('-');
      return ((bulan === 'semua') || (mo === bulan)) && ((tahun === 'semua') || (yr === tahun));
    });

    filtered.forEach(item => {
      let debet = 0, kredit = 0;
      let posText = item.sumberDana || 'Kas Tunai';

      if (item.jenis === 'pemasukan') {
        debet = item.nominal;
        runSaldo += debet;
        totDebet += debet;
      } else if (item.jenis === 'pengeluaran') {
        kredit = item.nominal;
        runSaldo -= kredit;
        totKredit += kredit;
      } else if (item.jenis === 'transfer') {
        posText = `${item.sumberDana} -> ${item.tujuanDana}`;
      }

      rows.push([
        formatTanggal(item.tanggal),
        posText,
        item.jenis === 'transfer' ? 'Transfer' : item.kategori,
        item.catatan || '-',
        debet ? formatRupiah(debet) : '-',
        kredit ? formatRupiah(kredit) : '-',
        formatRupiah(runSaldo)
      ]);
    });

    doc.autoTable({
      startY: 38,
      head: [['Tanggal', 'Pos / Rekening', 'Kategori', 'Catatan', 'Debet (Rp)', 'Kredit (Rp)', 'Saldo Kas (Rp)']],
      body: rows,
      foot: [['TOTAL', '', '', '', formatRupiah(totDebet), formatRupiah(totKredit), formatRupiah(runSaldo)]],
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: [241, 245, 249], textColor: 15, fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'center', cellWidth: 22 },
        1: { cellWidth: 28 },
        2: { cellWidth: 25 },
        3: { cellWidth: 32 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 25 },
        6: { halign: 'right', cellWidth: 25 }
      },
      styles: { fontSize: 8, cellPadding: 2 }
    });

    doc.save(`Laporan_BukuKas_${tahun}_${bulan}.pdf`);
  };
}

// 4. EKSPOR LAPORAN TO EXCEL (.xlsx)
function exportToExcel() {
  const bulan = document.getElementById('filterBulan').value;
  const tahun = document.getElementById('filterTahun').value;

  const tx = db.transaction('transaksi', 'readonly');
  tx.objectStore('transaksi').getAll().onsuccess = (e) => {
    const data = e.target.result;
    data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || a.id - b.id);

    let runSaldo = 0, totDebet = 0, totKredit = 0;

    const filtered = data.filter(item => {
      if (!item.tanggal) return true;
      const [yr, mo] = item.tanggal.split('-');
      return ((bulan === 'semua') || (mo === bulan)) && ((tahun === 'semua') || (yr === tahun));
    });

    const borderThin = {
      top: { style: 'thin', color: { rgb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } }
    };

    const styleTitle = {
      font: { name: 'Arial', sz: 14, bold: true, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const styleSubTitle = {
      font: { name: 'Arial', sz: 10, italic: true, color: { rgb: '475569' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const styleHeader = {
      font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: borderThin
    };

    const styleCellLeft = {
      font: { name: 'Arial', sz: 9, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: borderThin
    };

    const styleCellCenter = {
      font: { name: 'Arial', sz: 9, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: borderThin
    };

    const styleCellRight = {
      font: { name: 'Arial', sz: 9, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'right', vertical: 'center' },
      numFmt: '#,##0',
      border: borderThin
    };

    const styleTotalLabel = {
      font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '0F172A' } },
      fill: { fgColor: { rgb: 'E2E8F0' } },
      alignment: { horizontal: 'right', vertical: 'center' },
      border: borderThin
    };

    const styleTotalNum = {
      font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '0F172A' } },
      fill: { fgColor: { rgb: 'E2E8F0' } },
      alignment: { horizontal: 'right', vertical: 'center' },
      numFmt: '#,##0',
      border: borderThin
    };

    const wsData = [
      [{ v: 'LAPORAN BUKU KAS KELUARGA', s: styleTitle }],
      [{ v: `Periode: ${bulan === 'semua' ? 'Semua Bulan' : 'Bulan ' + bulan} ${tahun}`, s: styleSubTitle }],
      [{ v: `Tanggal Cetak: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`, s: styleSubTitle }],
      [], 
      [
        { v: 'Tanggal', s: styleHeader },
        { v: 'Pos / Rekening', s: styleHeader },
        { v: 'Kategori', s: styleHeader },
        { v: 'Catatan', s: styleHeader },
        { v: 'Debet (Pemasukan)', s: styleHeader },
        { v: 'Kredit (Pengeluaran)', s: styleHeader },
        { v: 'Saldo Kas', s: styleHeader }
      ]
    ];

    filtered.forEach(item => {
      let debet = 0, kredit = 0;
      let posText = item.sumberDana || 'Kas Tunai';

      if (item.jenis === 'pemasukan') {
        debet = item.nominal;
        runSaldo += debet;
        totDebet += debet;
      } else if (item.jenis === 'pengeluaran') {
        kredit = item.nominal;
        runSaldo -= kredit;
        totKredit += kredit;
      } else if (item.jenis === 'transfer') {
        posText = `${item.sumberDana} ➔ ${item.tujuanDana}`;
      }

      wsData.push([
        { v: formatTanggal(item.tanggal), s: styleCellCenter },
        { v: posText, s: styleCellLeft },
        { v: item.jenis === 'transfer' ? 'Transfer Internal' : item.kategori, s: styleCellLeft },
        { v: item.catatan || '-', s: styleCellLeft },
        { v: debet, s: styleCellRight, t: 'n' },
        { v: kredit, s: styleCellRight, t: 'n' },
        { v: runSaldo, s: styleCellRight, t: 'n' }
      ]);
    });

    wsData.push([
      { v: 'TOTAL KUMULATIF', s: styleTotalLabel },
      { v: '', s: styleTotalLabel },
      { v: '', s: styleTotalLabel },
      { v: '', s: styleTotalLabel },
      { v: totDebet, s: styleTotalNum, t: 'n' },
      { v: totKredit, s: styleTotalNum, t: 'n' },
      { v: runSaldo, s: styleTotalNum, t: 'n' }
    ]);

    const styledWs = XLSX.utils.aoa_to_sheet(wsData);

    styledWs['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
      { s: { r: wsData.length - 1, c: 0 }, e: { r: wsData.length - 1, c: 3 } }
    ];

    styledWs['!cols'] = [
      { wch: 16 },
      { wch: 28 },
      { wch: 22 },
      { wch: 35 },
      { wch: 22 },
      { wch: 22 },
      { wch: 24 }
    ];

    styledWs['!rows'] = [
      { hpt: 24 },
      { hpt: 18 },
      { hpt: 18 },
      { hpt: 10 },
      { hpt: 26 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, styledWs, "Buku Kas");

    XLSX.writeFile(wb, `Laporan_BukuKas_${tahun}_${bulan}.xlsx`);
  };
}

function hapusTransaksi(id) {
  if (confirm('Hapus transaksi ini?')) {
    const tx = db.transaction('transaksi', 'readwrite');
    tx.objectStore('transaksi').delete(id).onsuccess = () => tampilkanTransaksi();
  }
}

function initFilterTahun() {
  const selectTahun = document.getElementById('filterTahun');
  const thn = new Date().getFullYear();
  let html = '<option value="semua">Semua Tahun</option>';
  for (let t = thn - 2; t <= thn + 2; t++) {
    html += `<option value="${t}" ${t === thn ? 'selected' : ''}>${t}</option>`;
  }
  selectTahun.innerHTML = html;
}

document.getElementById('jenis').addEventListener('change', updateFormJenis);
document.addEventListener('DOMContentLoaded', checkAuth);