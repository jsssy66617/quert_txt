// 全局变量
let searchResults = [];
let currentPage = 1;
const resultsPerPage = 10;
let currentKeywords = [];

// 搜索控制相关全局变量
let isPaused = false;
let isStopped = false;
let resumePromiseResolve = null;

// 用于存储完整搜索结果的变量
let fullSearchResults = [];
// 用于标记是否处于单一文件结果视图
let isSingleFileView = false;
// 当前查看的单一文件名称
let currentViewingFile = null;

// 搜索记录相关全局变量
let searchHistory = [];
let currentHistoryPage = 1;
const historyPerPage = 10;

// 获取客户端信息
function getClientInfo() {
    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        // 由于浏览器安全限制，无法直接获取用户IP
        ip: '无法获取（浏览器安全限制）'
    };
}

// 保存搜索记录
function saveSearchRecord(keywords) {
    // 获取客户端信息
    const clientInfo = getClientInfo();
    
    // 创建搜索记录对象
    const record = {
        id: Date.now(),
        keywords: keywords,
        searchTime: new Date().toISOString(),
        clientInfo: clientInfo,
        count: 1 // 搜索次数
    };
    
    // 从localStorage读取现有记录
    let history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    
    // 检查是否有相同关键词的记录
    const existingIndex = history.findIndex(item => item.keywords.join(' ') === keywords.join(' '));
    
    if (existingIndex !== -1) {
        // 更新现有记录的搜索次数和时间
        history[existingIndex].count += 1;
        history[existingIndex].searchTime = record.searchTime;
        history[existingIndex].clientInfo = clientInfo;
    } else {
        // 添加新记录
        history.unshift(record);
        
        // 限制历史记录数量（最多保存100条）
        if (history.length > 100) {
            history = history.slice(0, 100);
        }
    }
    
    // 保存到localStorage
    localStorage.setItem('searchHistory', JSON.stringify(history));
    
    // 更新全局搜索历史
    searchHistory = history;
}

// 读取搜索记录
function loadSearchHistory() {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    searchHistory = history;
    return history;
}

// 获取搜索推荐（基于搜索次数）
function getSearchRecommendations(limit = 5) {
    return [...searchHistory]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(item => item.keywords);
}

// 检测文件编码
function detectEncoding(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        
        // 读取文件的前几个字节来检测BOM和内容特征
        const bytesToRead = Math.min(1024, file.size);
        
        reader.onload = (e) => {
            const buffer = new Uint8Array(e.target.result);
            
            // 检测BOM
            if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                resolve('UTF-8');
            } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
                resolve('UTF-16 BE');
            } else if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
                resolve('UTF-16 LE');
            } else if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xFE && buffer[3] === 0xFF) {
                resolve('UTF-32 BE');
            } else if (buffer.length >= 4 && buffer[0] === 0xFF && buffer[1] === 0xFE && buffer[2] === 0x00 && buffer[3] === 0x00) {
                resolve('UTF-32 LE');
            } else if (buffer.length >= 4 && buffer[0] === 0x2B && buffer[1] === 0x2F && buffer[2] === 0x76 && buffer[3] >= 0x38 && buffer[3] <= 0x3D) {
                resolve('UTF-7');
            } else if (buffer.length >= 4 && buffer[0] === 0x84 && buffer[1] === 0x31 && buffer[2] === 0x95 && buffer[3] === 0x33) {
                resolve('GB-18030');
            } else {
                // 没有BOM，基于内容特征推测编码
                resolve(guessEncoding(buffer));
            }
        };
        
        // 读取文件的前几个字节
        reader.readAsArrayBuffer(file.slice(0, bytesToRead));
    });
}

// 基于内容特征推测编码
function guessEncoding(buffer) {
    // 检查是否包含有效的UTF-8序列
    function isValidUTF8(buffer) {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
            decoder.decode(buffer);
            return true;
        } catch (e) {
            return false;
        }
    }
    
    // 检查是否可能是GBK/GB2312
    function mayBeGBK(buffer) {
        let gbCount = 0;
        let totalCount = 0;
        
        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 0x81 && byte <= 0xFE) {
                // GBK的第一个字节范围
                if (i + 1 < buffer.length) {
                    const nextByte = buffer[i + 1];
                    if (nextByte >= 0x40 && nextByte <= 0xFE && nextByte !== 0x7F) {
                        // GBK的第二个字节范围
                        gbCount++;
                        i++; // 跳过下一个字节
                    }
                }
                totalCount++;
            } else if (byte >= 0x20 && byte <= 0x7E) {
                // ASCII字符
                totalCount++;
            }
        }
        
        // 如果有较多的GBK特征字节，推测为GBK
        return gbCount > totalCount * 0.1;
    }
    
    // 检查是否是UTF-16（无BOM）
    function mayBeUTF16(buffer) {
        // UTF-16字符通常以null字节为特征
        let nullCount = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === 0x00) {
                nullCount++;
            }
        }
        // 如果null字节比例较高（约50%），可能是UTF-16
        return nullCount > buffer.length * 0.3;
    }
    
    // 优先检测UTF-8
    if (isValidUTF8(buffer)) {
        return 'UTF-8';
    }
    
    // 检测GBK/GB2312
    if (mayBeGBK(buffer)) {
        return 'GBK';
    }
    
    // 检测UTF-16
    if (mayBeUTF16(buffer)) {
        // 尝试两种UTF-16变体
        const decoderLE = new TextDecoder('utf-16le', { fatal: true });
        const decoderBE = new TextDecoder('utf-16be', { fatal: true });
        
        try {
            decoderLE.decode(buffer);
            return 'UTF-16 LE';
        } catch (e) {
            try {
                decoderBE.decode(buffer);
                return 'UTF-16 BE';
            } catch (e) {
                // 都失败，回退到UTF-8
                return 'UTF-8';
            }
        }
    }
    
    // 默认回退到UTF-8
    return 'UTF-8';
}

// 搜索进度相关全局变量
let searchProgress = [];
let currentProgressPage = 1;
const progressPerPage = 10;
let searchStartTime = 0;
let searchEndTime = 0;
let totalFiles = 0;
let completedFiles = 0;
let currentSearchingFile = '';
// 总关键词匹配数
let totalKeywordMatches = 0;

// 搜索进度排序相关全局变量
let progressSortBy = null;
let progressSortOrder = 'asc';

// DOM 元素
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const folderInput = document.getElementById('folderInput');
const fileInput = document.getElementById('fileInput');
const folderMode = document.getElementById('folderMode');
const fileMode = document.getElementById('fileMode');
const resultsList = document.getElementById('resultsList');
const resultsInfo = document.getElementById('resultsInfo');
const pagination = document.getElementById('pagination');
const sortSelect = document.getElementById('sortSelect');
const fileModal = document.getElementById('fileModal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementsByClassName('close')[0];

// 搜索控制相关DOM元素
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');

// 历史记录相关DOM元素
const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryModal = document.getElementById('closeHistoryModal');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyList = document.getElementById('historyList');
const historyPagination = document.getElementById('historyPagination');
const recommendationsSection = document.getElementById('recommendationsSection');
const recommendationsList = document.getElementById('recommendationsList');

// 搜索进度相关DOM元素
const progressSection = document.getElementById('progressSection');
const progressTableBody = document.getElementById('progressTableBody');
const progressPagination = document.getElementById('progressPagination');
const currentFileElement = document.getElementById('currentFile');
const progressCountElement = document.getElementById('progressCount');
const searchStatsElement = document.getElementById('searchStats');
const progressTable = document.getElementById('progressTable');
const sortMatchingLines = document.getElementById('sortMatchingLines');
const sortSearchTime = document.getElementById('sortSearchTime');

// 返回总查询界面
function returnToAllResults() {
    // 重置视图状态
    isSingleFileView = false;
    currentViewingFile = null;
    
    // 恢复完整搜索结果
    searchResults = [...fullSearchResults];
    
    // 重置页码并重新显示结果
    currentPage = 1;
    displayResults();
    
    // 显示搜索进度表格
    showProgressSection();
    
    // 恢复控制按钮显示（根据搜索状态）
    if (completedFiles < totalFiles && !isStopped) {
        if (isPaused) {
            pauseBtn.style.display = 'none';
            resumeBtn.style.display = 'inline-block';
        } else {
            pauseBtn.style.display = 'inline-block';
            resumeBtn.style.display = 'none';
        }
        stopBtn.style.display = 'inline-block';
    }
}

// 初始化事件监听
function init() {
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    folderInput.addEventListener('change', handleFolderSelect);
    fileInput.addEventListener('change', handleFileSelect);
    sortSelect.addEventListener('change', handleSort);
    closeModal.addEventListener('click', () => {
        fileModal.style.display = 'none';
    });
    window.addEventListener('click', (e) => {
        if (e.target === fileModal) {
            fileModal.style.display = 'none';
        } else if (e.target === historyModal) {
            historyModal.style.display = 'none';
        }
    });
    
    // 历史记录相关事件监听
    historyBtn.addEventListener('click', showHistoryModal);
    closeHistoryModal.addEventListener('click', () => {
        historyModal.style.display = 'none';
    });
    clearHistoryBtn.addEventListener('click', clearAllHistory);
    
    // 搜索控制相关事件监听
    pauseBtn.addEventListener('click', handlePauseSearch);
    resumeBtn.addEventListener('click', handleResumeSearch);
    stopBtn.addEventListener('click', handleStopSearch);
    
    // 返回总查询界面事件监听
    document.getElementById('returnToAllBtn').addEventListener('click', returnToAllResults);
    
    // 搜索进度表排序事件监听
    sortMatchingLines.addEventListener('click', () => handleProgressSort('matchingLines'));
    sortSearchTime.addEventListener('click', () => handleProgressSort('searchTime'));
    
    // 状态筛选器事件监听
    statusFilter.addEventListener('change', displayProgress);
    
    // 加载历史记录和显示推荐
    loadSearchHistory();
    displayRecommendations();
}

// 处理搜索
async function handleSearch() {
    const keywordText = searchInput.value.trim();
    if (!keywordText) {
        alert('请输入搜索关键词！');
        return;
    }
    
    // 将输入的关键词按空格分割成数组
    currentKeywords = keywordText.split(/\s+/).filter(k => k.length > 0);
    currentPage = 1;
    
    // 保存搜索记录
    saveSearchRecord(currentKeywords);
    
    // 根据选择的模式触发相应的文件选择
    if (folderMode.checked) {
        // 重置文件夹选择器
        folderInput.value = '';
        // 触发文件夹选择
        folderInput.click();
    } else {
        // 重置文件选择器
        fileInput.value = '';
        // 触发文件选择
        fileInput.click();
    }
}

// 暂停搜索
function handlePauseSearch() {
    isPaused = true;
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'inline-block';
    updateCurrentSearchingFile('搜索已暂停');
}

// 继续搜索
function handleResumeSearch() {
    isPaused = false;
    pauseBtn.style.display = 'inline-block';
    resumeBtn.style.display = 'none';
    
    // 如果有等待继续的Promise，解析它
    if (resumePromiseResolve) {
        resumePromiseResolve();
        resumePromiseResolve = null;
    }
}

// 停止搜索
function handleStopSearch() {
    isStopped = true;
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    updateCurrentSearchingFile('搜索已停止');
}

// 处理文件夹选择
async function handleFolderSelect(event) {
    const files = event.target.files;
    if (files.length === 0) return;
    
    // 筛选出txt文件
    let txtFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.txt'));
    
    // 搜索整个文件夹中的所有txt文件（包含子文件夹）
    // txtFiles = txtFiles.filter(file => !file.webkitRelativePath.includes('/'));
    
    if (txtFiles.length === 0) {
        // 确保结果界面可见
        showResultsSection();
        // 隐藏进度界面
        hideProgressSection();
        resultsInfo.textContent = '未找到任何TXT文件';
        resultsList.innerHTML = '';
        pagination.innerHTML = '';
        return;
    }
    
    // 初始化搜索进度
    initSearchProgress(txtFiles);
    
    // 显示进度界面
    showProgressSection();
    
    // 隐藏结果界面
    hideResultsSection();
    
    // 扫描文件内容
    searchResults = await scanTxtFiles(txtFiles, currentKeywords);
    // 保存完整搜索结果
    fullSearchResults = [...searchResults];
    
    // 搜索完成，记录结束时间
    searchEndTime = Date.now();
    
    // 应用排序
    sortResults();
    
    // 先准备好结果数据
    displayResults();
    showSearchStats();
    
    // 延迟显示结果界面，确保数据准备完成，减少闪烁
    setTimeout(() => {
        // 显示结果界面
        showResultsSection();
    }, 100);
    
    // 不隐藏进度界面，让用户可以查看每个文件的搜索进度
    // hideProgressSection();
}

// 处理指定文件选择
async function handleFileSelect(event) {
    const files = event.target.files;
    if (files.length === 0) return;
    
    // 筛选出txt文件
    let txtFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.txt'));
    
    if (txtFiles.length === 0) {
        // 确保结果界面可见
        showResultsSection();
        // 隐藏进度界面
        hideProgressSection();
        resultsInfo.textContent = '未找到任何TXT文件';
        resultsList.innerHTML = '';
        pagination.innerHTML = '';
        return;
    }
    
    // 初始化搜索进度
    initSearchProgress(txtFiles);
    
    // 显示进度界面
    showProgressSection();
    
    // 隐藏结果界面
    hideResultsSection();
    
    // 扫描文件内容
    searchResults = await scanTxtFiles(txtFiles, currentKeywords);
    
    // 搜索完成，记录结束时间
    searchEndTime = Date.now();
    
    // 应用排序
    sortResults();
    
    // 先准备好结果数据
    displayResults();
    showSearchStats();
    
    // 延迟显示结果界面，确保数据准备完成，减少闪烁
    setTimeout(() => {
        // 显示结果界面
        showResultsSection();
    }, 100);
    
    // 不隐藏进度界面，让用户可以查看每个文件的搜索进度
    // hideProgressSection();
}

// 统计精确关键词匹配次数
function countExactKeywordMatches(content, keywords) {
    let totalMatches = 0;
    
    keywords.forEach(keyword => {
        if (keyword) {
            // 使用正则表达式匹配所有出现的关键词（不区分大小写）
            const regex = new RegExp(keyword.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&'), 'gi');
            const matches = content.match(regex);
            if (matches) {
                totalMatches += matches.length;
            }
        }
    });
    
    return totalMatches;
}

// 使用Fuse.js进行分词搜索
function searchWithFuse(lines, keywords) {
    // 准备Fuse.js搜索数据
    const searchData = lines.map((line, index) => ({
        lineNum: index + 1,
        content: line
    }));
    
    // 配置Fuse.js选项
    const options = {
        keys: ['content'],
        threshold: 0.3, // 匹配阈值，值越小越严格
        tokenize: true, // 启用分词模式，提高中文搜索准确性
        includeScore: true
    };
    
    // 创建Fuse实例
    const fuse = new Fuse(searchData, options);
    
    // 对每个关键词进行搜索，并收集所有匹配的行号
    const allMatchedLines = new Set();
    
    keywords.forEach(keyword => {
        const matches = fuse.search(keyword);
        matches.forEach(match => {
            allMatchedLines.add(match.item.lineNum);
        });
    });
    
    // 转换为匹配行数组
    const matchingLines = Array.from(allMatchedLines)
        .sort((a, b) => a - b)
        .map(lineNum => ({
            lineNum: lineNum,
            content: lines[lineNum - 1]
        }));
    
    return matchingLines;
}

// 扫描TXT文件内容
async function scanTxtFiles(files, keywords) {
    const results = [];
    const MAX_SIZE_FOR_PARTIAL_READ = 450 * 1024; // 450KB
    
    // 重置搜索控制状态
    isPaused = false;
    isStopped = false;
    resumePromiseResolve = null;
    
    for (let i = 0; i < files.length; i++) {
        // 检查是否已停止搜索
        if (isStopped) {
            break;
        }
        
        // 检查是否已暂停搜索
        while (isPaused) {
            await new Promise((resolve) => {
                resumePromiseResolve = resolve;
            });
        }
        
        const file = files[i];
        const fileIndex = i;
        
        // 更新当前搜索文件
        updateCurrentSearchingFile(file);
        
        // 记录文件开始搜索时间
        searchProgress[fileIndex].startTime = Date.now();
        
        // 更新文件状态为搜索中
        updateFileProgress(fileIndex, 'searching');
        
        try {
            // 读取文件内容（大文件只读取前100行）
            const fileResult = await readFileContent(file);
            const content = fileResult.content;
            const encoding = fileResult.encoding;
            const lines = content.split('\n');
            
            // 查找包含所有关键词的行
            const matchingLines = searchWithFuse(lines, keywords);
            
            // 统计精确的关键词匹配次数
            const exactMatches = countExactKeywordMatches(content, keywords);
            
            if (matchingLines.length > 0) {
                results.push({
                    file: file,
                    name: file.name,
                    path: file.webkitRelativePath || file.name,
                    size: file.size,
                    lastModified: file.lastModified,
                    matchingLines: matchingLines,
                    exactMatches: exactMatches, // 存储精确匹配次数
                    isLargeFile: file.size > MAX_SIZE_FOR_PARTIAL_READ, // 标记是否为大文件
                    encoding: encoding // 存储文件编码信息
                });
            }
            
            // 更新总关键词匹配数
            totalKeywordMatches += exactMatches;
            
            // 记录文件结束搜索时间和匹配行数
            searchProgress[fileIndex].endTime = Date.now();
            searchProgress[fileIndex].matchingLines = matchingLines.length;
            
            // 更新文件状态为完成
            updateFileProgress(fileIndex, 'completed', matchingLines.length > 0);
        } catch (error) {
            console.error('扫描文件出错:', error);
            
            // 记录文件结束搜索时间（即使失败）
            searchProgress[fileIndex].endTime = Date.now();
            
            // 更新文件状态为失败
            updateFileProgress(fileIndex, 'failed');
        }
        
        // 更新已完成文件数量
        completedFiles++;
        
        // 更新进度计数
        updateProgressCount();
        
        // 进度表格已经在updateFileProgress中更新，这里不需要重复调用
        // displayProgress();
    }
    
    // 搜索结束，恢复按钮状态
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    
    return results;
}

// 读取文件内容
// isFullContent: 是否读取完整内容，默认false（大文件只读取前100行）
async function readFileContent(file, isFullContent = false) {
    // 先检测文件编码
    const encoding = await detectEncoding(file);
    
    return new Promise((resolve, reject) => {
        const MAX_SIZE_FOR_PARTIAL_READ = 450 * 1024; // 450KB
        const MAX_LINES_TO_PREVIEW = 100;
        const LARGE_FILE_WARNING_THRESHOLD = 450 * 1024; // 450KB（提前警告）
        
        // 对于接近450KB的文件，提高阈值，确保378KB等文件能被完整读取
        const isNearLargeFile = file.size > LARGE_FILE_WARNING_THRESHOLD && file.size <= MAX_SIZE_FOR_PARTIAL_READ;
        
        // 使用指定编码读取文件的辅助函数
        function readWithEncoding(reader, filePart) {
            reader.onload = (e) => resolve({ content: e.target.result, encoding });
            reader.onerror = (e) => {
                console.error(`File read error with encoding ${encoding}:`, e);
                // 尝试不带编码读取（让浏览器自动检测）
                const fallbackReader = new FileReader();
                fallbackReader.onload = (e) => resolve({ content: e.target.result, encoding: '自动检测' });
                fallbackReader.onerror = reject;
                fallbackReader.readAsText(filePart);
            };
            // 使用检测到的编码读取文件
            reader.readAsText(filePart, encoding);
        }
        
        // 小文件（小于450KB）、接近大文件（450-500KB）或请求完整内容时，直接读取整个文件
        if ((file.size <= LARGE_FILE_WARNING_THRESHOLD || isNearLargeFile || isFullContent)) {
            const reader = new FileReader();
            readWithEncoding(reader, file);
            return;
        }
        
        // 只有真正的大文件（超过450KB）才采用部分读取方式
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const lines = content.split('\n');
            
            // 如果已经读取了超过100行，只返回前100行
            if (lines.length > MAX_LINES_TO_PREVIEW) {
                resolve({ content: lines.slice(0, MAX_LINES_TO_PREVIEW).join('\n'), encoding });
            } else {
                // 如果还没到100行，但文件还没读完，继续读取
                // 增加读取大小，确保能覆盖更多内容
                const largerReader = new FileReader();
                largerReader.onload = (e) => {
                    const largerContent = e.target.result;
                    const largerLines = largerContent.split('\n');
                    resolve({ content: largerLines.slice(0, MAX_LINES_TO_PREVIEW).join('\n'), encoding });
                };
                largerReader.onerror = (e) => {
                    console.error(`Larger file read error with encoding ${encoding}:`, e);
                    // 如果更大读取也失败，返回之前读取的内容
                    resolve({ content, encoding });
                };
                // 读取文件的前128KB，增加找到关键词的概率
                largerReader.readAsText(file.slice(0, 128 * 1024), encoding);
            }
        };
        reader.onerror = (e) => {
            console.error(`Partial file read error with encoding ${encoding}:`, e);
            reject(new Error('无法读取文件内容'));
        };
        
        // 读取文件的前128KB（通常足够包含100行文本）
        reader.readAsText(file.slice(0, 128 * 1024), encoding);
    });
}

// 排序结果
function sortResults() {
    const sortValue = sortSelect.value;
    
    searchResults.sort((a, b) => {
        switch (sortValue) {
            case 'time-desc':
                return b.lastModified - a.lastModified;
            case 'time-asc':
                return a.lastModified - b.lastModified;
            case 'size-desc':
                return b.size - a.size;
            case 'size-asc':
                return a.size - b.size;
            default:
                return b.lastModified - a.lastModified;
        }
    });
}

// 处理排序变化
function handleSort() {
    if (searchResults.length === 0) return;
    
    sortResults();
    displayResults();
}

// 显示结果
function displayResults() {
    const totalResults = searchResults.length;
    const totalPages = Math.ceil(totalResults / resultsPerPage);
    
    // 更新结果信息
    if (isSingleFileView && currentViewingFile) {
        resultsInfo.textContent = `文件 "${currentViewingFile}" 中包含关键词 "${currentKeywords.join('、')}" 的结果`;
        // 显示返回按钮
        document.getElementById('viewControls').style.display = 'block';
    } else {
        resultsInfo.textContent = `找到 ${totalResults} 个包含关键词 "${currentKeywords.join('、')}" 的文件`;
        // 隐藏返回按钮
        document.getElementById('viewControls').style.display = 'none';
    }
    
    // 计算当前页的结果
    const startIndex = (currentPage - 1) * resultsPerPage;
    const endIndex = startIndex + resultsPerPage;
    const currentResults = searchResults.slice(startIndex, endIndex);
    
    // 渲染结果列表
    resultsList.innerHTML = '';
    
    currentResults.forEach((result, index) => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        
        const header = document.createElement('div');
        header.className = 'result-header';
        header.innerHTML = `
            <h3>${result.name} [${result.encoding}] (匹配关键词: ${result.exactMatches}次)</h3>
            <div class="file-info">
                <span>${result.path}</span>
                <span>${formatFileSize(result.size)}</span>
                <span>${formatDate(result.lastModified)}</span>
            </div>
        `;
        
        // 为文件名添加点击事件
        const fileNameElement = header.querySelector('h3');
        fileNameElement.style.cursor = 'pointer';
        fileNameElement.style.color = '#3498db';
        fileNameElement.addEventListener('click', () => {
            // 保存当前视图状态
            currentViewingFile = result.name;
            isSingleFileView = true;
            
            // 筛选出该文件的结果
            searchResults = fullSearchResults.filter(r => r.name === currentViewingFile);
            
            // 重置页码并重新显示结果
            currentPage = 1;
            displayResults();
        });
        
        const content = document.createElement('div');
        content.className = 'result-content';
        
        // 只显示第一个匹配行
        if (result.matchingLines.length > 0) {
            const firstMatch = result.matchingLines[0];
            content.innerHTML = `
                <p class="matching-line" data-line-number="${firstMatch.lineNum}">
                    <strong>第 ${firstMatch.lineNum} 行：</strong>
                    ${highlightKeyword(firstMatch.content, currentKeywords)}
                </p>
                ${result.matchingLines.length > 1 ? `<p class="more-matches">... 还有 ${result.matchingLines.length - 1} 个匹配行</p>` : ''}
                ${result.isLargeFile ? '<p class="large-file-warning">⚠️ 该文件过大，仅显示前100行预览内容</p>' : ''}
            `;
            
            // 添加点击事件监听器
            const matchingLine = content.querySelector('.matching-line');
            matchingLine.addEventListener('click', async () => {
                // 打开文件详情模态框
                await showFileDetails(result);
                
                // 定位到对应的行
                const targetLine = document.querySelector(`.line-content[data-line-number="${firstMatch.lineNum}"]`);
                if (targetLine) {
                    // 滚动到该行
                    targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // 高亮该行
                    targetLine.classList.add('highlighted-line');
                    setTimeout(() => {
                        targetLine.classList.remove('highlighted-line');
                    }, 2000);
                    
                    // 显示位置信息
                    const totalLines = document.querySelectorAll('.line-content').length;
                    const lineNumber = firstMatch.lineNum;
                    const positionPercent = ((lineNumber - 1) / totalLines * 100).toFixed(2);
                    showPositionInfo(targetLine, lineNumber, positionPercent);
                }
            });
        }
        
        const actions = document.createElement('div');
        actions.className = 'result-actions';
        const viewBtn = document.createElement('button');
        viewBtn.className = 'view-btn';
        viewBtn.textContent = '查看详情';
        viewBtn.addEventListener('click', () => showFileDetails(result));
        actions.appendChild(viewBtn);
        
        resultItem.appendChild(header);
        resultItem.appendChild(content);
        resultItem.appendChild(actions);
        resultsList.appendChild(resultItem);
    });
    
    // 渲染分页
    renderPagination(totalPages);
}

// 高亮关键词
function highlightKeyword(text, keywords) {
    let result = text;
    // 按关键词长度降序排列，避免短关键词被长关键词覆盖
    const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
    
    sortedKeywords.forEach(keyword => {
        if (keyword) {
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            result = result.replace(regex, '<span class="highlight">$1</span>');
        }
    });
    
    return result;
}

// 渲染分页
function renderPagination(totalPages) {
    pagination.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一页';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            displayResults();
        }
    });
    pagination.appendChild(prevBtn);
    
    // 页码按钮
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    if (startPage > 1) {
        const firstPageBtn = document.createElement('button');
        firstPageBtn.textContent = '1';
        firstPageBtn.className = currentPage === 1 ? 'active' : '';
        firstPageBtn.addEventListener('click', () => {
            currentPage = 1;
            displayResults();
        });
        pagination.appendChild(firstPageBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            pagination.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.className = currentPage === i ? 'active' : '';
        pageBtn.addEventListener('click', () => {
            currentPage = i;
            displayResults();
        });
        pagination.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            pagination.appendChild(ellipsis);
        }
        
        const lastPageBtn = document.createElement('button');
        lastPageBtn.textContent = totalPages;
        lastPageBtn.className = currentPage === totalPages ? 'active' : '';
        lastPageBtn.addEventListener('click', () => {
            currentPage = totalPages;
            displayResults();
        });
        pagination.appendChild(lastPageBtn);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一页';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            displayResults();
        }
    });
    pagination.appendChild(nextBtn);
}

// 显示文件详情
async function showFileDetails(result) {
    modalTitle.textContent = `${result.name} [${result.encoding}] (匹配关键词: ${result.exactMatches}次)`;
    
    // 读取完整文件内容（无论文件大小）
    const fileResult = await readFileContent(result.file, true);
    const content = fileResult.content;
    
    // 高亮关键词
    const highlightedContent = highlightKeyword(content, currentKeywords);
    
    // 按行显示
    const lines = highlightedContent.split('\n');
    const originalLines = content.split('\n');
    const totalLines = lines.length;
    
    // 筛选出包含关键词的行
    let html = '<pre>';
    let hasMatchingLines = false;
    
    lines.forEach((line, index) => {
        // 检查原始行是否包含任何关键词
        const originalLine = originalLines[index];
        const hasKeyword = currentKeywords.some(keyword => 
            keyword && originalLine.toLowerCase().includes(keyword.toLowerCase())
        );
        
        if (hasKeyword) {
            hasMatchingLines = true;
            html += `<span class="line-number">${index + 1}</span> <span class="line-content" data-line-number="${index + 1}">${line}</span>\n`;
        }
    });
    
    // 如果没有匹配的行，显示提示信息
    if (!hasMatchingLines) {
        html += '<div style="text-align: center; color: #7f8c8d; padding: 20px;">该文件中没有找到匹配的内容</div>';
    }
    
    html += '</pre>';
    
    modalContent.innerHTML = html;
    fileModal.style.display = 'block';
    
    // 添加行点击事件监听器
    const lineContents = modalContent.querySelectorAll('.line-content');
    
    lineContents.forEach(lineContent => {
        lineContent.addEventListener('click', (e) => {
            const lineNumber = parseInt(e.target.dataset.lineNumber);
            const positionPercent = ((lineNumber - 1) / totalLines * 100).toFixed(2);
            
            // 创建并显示位置信息提示
            showPositionInfo(lineContent, lineNumber, positionPercent);
        });
    });
}

// 显示行位置信息
function showPositionInfo(element, lineNumber, positionPercent) {
    // 移除之前的提示
    const existingTooltip = document.querySelector('.position-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }
    
    // 创建新的提示元素
    const tooltip = document.createElement('div');
    tooltip.className = 'position-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-content">
            <div class="tooltip-line">行号：${lineNumber}</div>
            <div class="tooltip-position">位置：${positionPercent}%</div>
        </div>
    `;
    
    // 设置提示位置
    const rect = element.getBoundingClientRect();
    const modalRect = fileModal.getBoundingClientRect();
    
    tooltip.style.left = (rect.left - modalRect.left + 50) + 'px';
    tooltip.style.top = (rect.top - modalRect.top) + 'px';
    
    // 添加到模态框内容中
    modalContent.appendChild(tooltip);
    
    // 3秒后自动移除提示
    setTimeout(() => {
        if (tooltip.parentNode) {
            tooltip.remove();
        }
    }, 3000);
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
    else return (bytes / 1048576).toFixed(2) + ' MB';
}

// 格式化日期
function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
}

// 搜索进度相关函数

// 初始化搜索进度
function initSearchProgress(files) {
    searchProgress = [];
    currentProgressPage = 1;
    searchStartTime = Date.now();
    searchEndTime = 0;
    totalFiles = files.length;
    completedFiles = 0;
    currentSearchingFile = '';
    // 重置总关键词匹配数
    totalKeywordMatches = 0;
    
    // 初始化每个文件的进度状态
    files.forEach((file, index) => {
        searchProgress.push({
            id: index,
            name: file.name,
            path: file.webkitRelativePath || file.name,
            status: 'waiting',
            hasMatches: false,
            matchingLines: 0,
            startTime: 0,
            endTime: 0
        });
    });
}

// 显示进度界面
function showProgressSection() {
    progressSection.style.display = 'block';
}

// 隐藏进度界面
function hideProgressSection() {
    progressSection.style.display = 'none';
}

// 显示结果界面
function showResultsSection() {
    document.getElementById('resultsSection').style.display = 'block';
}

// 隐藏结果界面
function hideResultsSection() {
    document.getElementById('resultsSection').style.display = 'none';
}

// 更新当前搜索文件
function updateCurrentSearchingFile(file) {
    currentSearchingFile = file.name;
    currentFileElement.textContent = `当前文件：${currentSearchingFile}`;
}

// 更新进度计数
function updateProgressCount() {
    progressCountElement.textContent = `已完成：${completedFiles} / ${totalFiles}`;
}

// 更新文件进度
function updateFileProgress(fileIndex, status, hasMatches = false) {
    searchProgress[fileIndex].status = status;
    searchProgress[fileIndex].hasMatches = hasMatches;
    
    // 更新进度表格
    displayProgress();
}

// 显示搜索统计
function showSearchStats() {
    const searchTime = (searchEndTime - searchStartTime) / 1000;
    searchStatsElement.innerHTML = `
        <div class="stats-content">
            <h3>搜索完成</h3>
            <p>总搜索时间：${searchTime.toFixed(2)}秒</p>
            <p>总共搜索：${totalFiles}个TXT文件</p>
            <p>找到匹配：${searchResults.length}个文件</p>
            <p>精确关键词匹配：${totalKeywordMatches}次</p>
        </div>
    `;
}

// 处理搜索进度表排序
function handleProgressSort(column) {
    // 如果点击的是当前排序列，切换排序方向
    if (progressSortBy === column) {
        progressSortOrder = progressSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        // 否则，设置新的排序列和默认排序方向
        progressSortBy = column;
        progressSortOrder = 'asc';
    }
    
    // 更新排序箭头显示
    updateSortArrows();
    
    // 重新显示进度表
    displayProgress();
}

// 更新排序箭头显示
function updateSortArrows() {
    // 重置所有排序箭头
    document.querySelectorAll('.sort-arrow').forEach(arrow => {
        arrow.className = 'sort-arrow';
    });
    
    // 如果没有排序，直接返回
    if (!progressSortBy) return;
    
    // 根据当前排序列和方向更新箭头
    if (progressSortBy === 'matchingLines') {
        const arrow = document.querySelector('#sortMatchingLines .sort-arrow');
        arrow.className += progressSortOrder === 'asc' ? ' asc' : ' desc';
    } else if (progressSortBy === 'searchTime') {
        const arrow = document.querySelector('#sortSearchTime .sort-arrow');
        arrow.className += progressSortOrder === 'asc' ? ' asc' : ' desc';
    }
}

// 对搜索进度进行排序
function sortSearchProgress(progress) {
    // 如果没有排序条件，直接返回原始进度
    if (!progressSortBy) return progress;
    
    // 根据排序列和方向进行排序
    const sortedProgress = [...progress].sort((a, b) => {
        let aVal, bVal;
        
        if (progressSortBy === 'matchingLines') {
            aVal = a.matchingLines;
            bVal = b.matchingLines;
        } else if (progressSortBy === 'searchTime') {
            // 计算搜索时间
            const aTime = a.status === 'completed' || a.status === 'failed' ? a.endTime - a.startTime : 0;
            const bTime = b.status === 'completed' || b.status === 'failed' ? b.endTime - b.startTime : 0;
            aVal = aTime;
            bVal = bTime;
        }
        
        // 根据排序方向比较
        if (progressSortOrder === 'asc') {
            return aVal - bVal;
        } else {
            return bVal - aVal;
        }
    });
    
    return sortedProgress;
}

// 显示进度
function displayProgress() {
    // 应用状态过滤
    let filteredProgress = [...searchProgress];
    const statusFilterValue = statusFilter.value;
    
    if (statusFilterValue !== 'all') {
        filteredProgress = filteredProgress.filter(item => {
            switch (statusFilterValue) {
                case 'waiting':
                    return item.status === 'waiting';
                case 'searching':
                    return item.status === 'searching';
                case 'completed-matches':
                    return item.status === 'completed' && item.hasMatches;
                case 'completed-no-matches':
                    return item.status === 'completed' && !item.hasMatches;
                case 'failed':
                    return item.status === 'failed';
                default:
                    return true;
            }
        });
    }
    
    const totalPages = Math.ceil(filteredProgress.length / progressPerPage);
    
    // 计算当前页的进度
    const startIndex = (currentProgressPage - 1) * progressPerPage;
    const endIndex = startIndex + progressPerPage;
    let currentProgress = filteredProgress.slice(startIndex, endIndex);
    
    // 对当前页的进度进行排序
    currentProgress = sortSearchProgress(currentProgress);
    
    // 渲染进度表格
    renderProgressTable(currentProgress);
    
    // 渲染进度分页
    renderProgressPagination(totalPages);
}

// 渲染进度表格
function renderProgressTable(progress) {
    progressTableBody.innerHTML = '';
    
    progress.forEach(item => {
        const row = document.createElement('tr');
        row.className = `progress-row ${item.status}`;
        
        const nameCell = document.createElement('td');
        nameCell.textContent = item.name;
        nameCell.className = 'progress-name';
        
        // 为文件名添加点击事件，查看单一文件结果
        if (item.hasMatches) {
            nameCell.style.cursor = 'pointer';
            nameCell.style.color = '#3498db';
            nameCell.addEventListener('click', () => {
                // 保存当前视图状态
                currentViewingFile = item.name;
                isSingleFileView = true;
                
                // 筛选出该文件的结果
                searchResults = fullSearchResults.filter(r => r.name === currentViewingFile);
                
                // 切换到结果界面
                showResultsSection();
                hideProgressSection();
                
                // 重置页码并重新显示结果
                currentPage = 1;
                displayResults();
            });
        }
        
        const pathCell = document.createElement('td');
        pathCell.textContent = item.path;
        pathCell.className = 'progress-path';
        
        const statusCell = document.createElement('td');
        statusCell.className = 'progress-status';
        
        switch (item.status) {
            case 'waiting':
                statusCell.innerHTML = '<span class="status-waiting">等待</span>';
                break;
            case 'searching':
                statusCell.innerHTML = '<span class="status-searching">搜索中</span>';
                break;
            case 'completed':
                statusCell.innerHTML = item.hasMatches ? 
                    '<span class="status-completed-matches">找到匹配</span>' : 
                    '<span class="status-completed-no-matches">无匹配</span>';
                break;
            case 'failed':
                statusCell.innerHTML = '<span class="status-failed">搜索失败</span>';
                break;
        }
        
        // 匹配行数列
        const matchingLinesCell = document.createElement('td');
        matchingLinesCell.className = 'progress-matching-lines';
        matchingLinesCell.textContent = item.status === 'completed' ? item.matchingLines : '-';
        
        // 搜索时间列
        const searchTimeCell = document.createElement('td');
        searchTimeCell.className = 'progress-search-time';
        if (item.status === 'completed' || item.status === 'failed') {
            const searchTime = (item.endTime - item.startTime) / 1000;
            searchTimeCell.textContent = `${searchTime.toFixed(2)}s`;
        } else if (item.status === 'searching') {
            const elapsedTime = (Date.now() - item.startTime) / 1000;
            searchTimeCell.textContent = `${elapsedTime.toFixed(2)}s...`;
        } else {
            searchTimeCell.textContent = '-';
        }
        
        // 进度条列
        const progressCell = document.createElement('td');
        progressCell.className = 'progress-bar-cell';
        
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        
        if (item.status === 'searching') {
            progressFill.style.width = '50%';
            progressFill.classList.add('progress-animated');
        } else if (item.status === 'completed' || item.status === 'failed') {
            progressFill.style.width = '100%';
        } else {
            progressFill.style.width = '0%';
        }
        
        progressBar.appendChild(progressFill);
        progressCell.appendChild(progressBar);
        
        row.appendChild(nameCell);
        row.appendChild(pathCell);
        row.appendChild(statusCell);
        row.appendChild(matchingLinesCell);
        row.appendChild(searchTimeCell);
        row.appendChild(progressCell);
        
        progressTableBody.appendChild(row);
    });
}

// 渲染进度分页
function renderProgressPagination(totalPages) {
    progressPagination.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一页';
    prevBtn.disabled = currentProgressPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentProgressPage > 1) {
            currentProgressPage--;
            displayProgress();
        }
    });
    progressPagination.appendChild(prevBtn);
    
    // 页码按钮
    const startPage = Math.max(1, currentProgressPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    if (startPage > 1) {
        const firstPageBtn = document.createElement('button');
        firstPageBtn.textContent = '1';
        firstPageBtn.className = currentProgressPage === 1 ? 'active' : '';
        firstPageBtn.addEventListener('click', () => {
            currentProgressPage = 1;
            displayProgress();
        });
        progressPagination.appendChild(firstPageBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            progressPagination.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.className = currentProgressPage === i ? 'active' : '';
        pageBtn.addEventListener('click', () => {
            currentProgressPage = i;
            displayProgress();
        });
        progressPagination.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            progressPagination.appendChild(ellipsis);
        }
        
        const lastPageBtn = document.createElement('button');
        lastPageBtn.textContent = totalPages;
        lastPageBtn.className = currentProgressPage === totalPages ? 'active' : '';
        lastPageBtn.addEventListener('click', () => {
            currentProgressPage = totalPages;
            displayProgress();
        });
        progressPagination.appendChild(lastPageBtn);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一页';
    nextBtn.disabled = currentProgressPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentProgressPage < totalPages) {
            currentProgressPage++;
            displayProgress();
        }
    });
    progressPagination.appendChild(nextBtn);
}

// 显示历史记录模态框
function showHistoryModal() {
    loadSearchHistory();
    displayHistory();
    historyModal.style.display = 'block';
}

// 显示搜索历史
function displayHistory() {
    const totalHistory = searchHistory.length;
    const totalPages = Math.ceil(totalHistory / historyPerPage);
    
    // 计算当前页的历史记录
    const startIndex = (currentHistoryPage - 1) * historyPerPage;
    const endIndex = startIndex + historyPerPage;
    const currentHistory = searchHistory.slice(startIndex, endIndex);
    
    // 渲染历史记录列表
    historyList.innerHTML = '';
    
    if (currentHistory.length === 0) {
        historyList.innerHTML = '<div class="no-history">暂无搜索历史</div>';
        historyPagination.innerHTML = '';
        return;
    }
    
    currentHistory.forEach((record, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        
        historyItem.innerHTML = `
            <div class="history-header">
                <div class="history-keywords">
                    <strong>关键词：</strong>${record.keywords.join('、')}
                </div>
                <div class="history-time">
                    ${formatDate(new Date(record.searchTime).getTime())}
                </div>
            </div>
            <div class="history-details">
                <div><strong>搜索次数：</strong>${record.count}</div>
                <div><strong>客户端信息：</strong></div>
                <div class="client-info">
                    <div>平台：${record.clientInfo.platform}</div>
                    <div>浏览器语言：${record.clientInfo.language}</div>
                    <div>IP：${record.clientInfo.ip}</div>
                </div>
            </div>
            <div class="history-actions">
                <button class="re-search-btn" data-keywords="${JSON.stringify(record.keywords)}">重新搜索</button>
                <button class="delete-history-btn" data-id="${record.id}">删除</button>
            </div>
        `;
        
        historyList.appendChild(historyItem);
    });
    
    // 添加事件监听器
    addHistoryItemEventListeners();
    
    // 渲染分页
    renderHistoryPagination(totalPages);
}

// 添加历史记录项的事件监听器
function addHistoryItemEventListeners() {
    // 重新搜索按钮
    document.querySelectorAll('.re-search-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const keywords = JSON.parse(e.target.dataset.keywords);
            reSearch(keywords);
        });
    });
    
    // 删除记录按钮
    document.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.dataset.id);
            deleteSearchRecord(id);
        });
    });
}

// 重新搜索
function reSearch(keywords) {
    // 填充搜索框
    searchInput.value = keywords.join(' ');
    
    // 关闭历史模态框
    historyModal.style.display = 'none';
    
    // 执行搜索
    handleSearch();
}

// 删除搜索记录
function deleteSearchRecord(id) {
    // 从数组中删除记录
    const index = searchHistory.findIndex(record => record.id === id);
    if (index !== -1) {
        searchHistory.splice(index, 1);
        
        // 保存到localStorage
        localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
        
        // 更新显示
        displayHistory();
        displayRecommendations();
    }
}

// 清空所有历史记录
function clearAllHistory() {
    if (confirm('确定要清空所有搜索历史吗？此操作不可恢复。')) {
        // 清空数组
        searchHistory = [];
        
        // 清空localStorage
        localStorage.removeItem('searchHistory');
        
        // 更新显示
        displayHistory();
        displayRecommendations();
        
        // 关闭模态框
        historyModal.style.display = 'none';
    }
}

// 渲染历史记录分页
function renderHistoryPagination(totalPages) {
    historyPagination.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一页';
    prevBtn.disabled = currentHistoryPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentHistoryPage > 1) {
            currentHistoryPage--;
            displayHistory();
        }
    });
    historyPagination.appendChild(prevBtn);
    
    // 页码按钮
    const startPage = Math.max(1, currentHistoryPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    if (startPage > 1) {
        const firstPageBtn = document.createElement('button');
        firstPageBtn.textContent = '1';
        firstPageBtn.className = currentHistoryPage === 1 ? 'active' : '';
        firstPageBtn.addEventListener('click', () => {
            currentHistoryPage = 1;
            displayHistory();
        });
        historyPagination.appendChild(firstPageBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            historyPagination.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.className = currentHistoryPage === i ? 'active' : '';
        pageBtn.addEventListener('click', () => {
            currentHistoryPage = i;
            displayHistory();
        });
        historyPagination.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            historyPagination.appendChild(ellipsis);
        }
        
        const lastPageBtn = document.createElement('button');
        lastPageBtn.textContent = totalPages;
        lastPageBtn.className = currentHistoryPage === totalPages ? 'active' : '';
        lastPageBtn.addEventListener('click', () => {
            currentHistoryPage = totalPages;
            displayHistory();
        });
        historyPagination.appendChild(lastPageBtn);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一页';
    nextBtn.disabled = currentHistoryPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentHistoryPage < totalPages) {
            currentHistoryPage++;
            displayHistory();
        }
    });
    historyPagination.appendChild(nextBtn);
}

// 显示搜索推荐
function displayRecommendations() {
    const recommendations = getSearchRecommendations();
    
    if (recommendations.length === 0) {
        recommendationsSection.style.display = 'none';
        return;
    }
    
    recommendationsSection.style.display = 'block';
    recommendationsList.innerHTML = '';
    
    recommendations.forEach(keywords => {
        const recommendationItem = document.createElement('div');
        recommendationItem.className = 'recommendation-item';
        recommendationItem.textContent = keywords.join(' ');
        recommendationItem.dataset.keywords = JSON.stringify(keywords);
        
        // 添加点击事件
        recommendationItem.addEventListener('click', (e) => {
            const keywords = JSON.parse(e.target.dataset.keywords);
            searchInput.value = keywords.join(' ');
            handleSearch();
        });
        
        recommendationsList.appendChild(recommendationItem);
    });
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', init);