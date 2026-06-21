# Token Chat 安装包构建完成

## 构建时间
2026年6月21日

## 生成的安装包

### 1. NSIS 安装包
- **文件路径**: `token-chat/src-tauri/target/release/bundle/nsis/Token Chat_0.5.8_x64-setup.exe`
- **文件大小**: 3,414,739 字节 (约 3.26 MB)
- **特点**:
  - 支持自定义安装路径
  - 支持创建桌面快捷方式和开始菜单
  - 支持多语言界面 (简体中文/英文)
  - 支持当前用户或所有用户安装模式
  - 包含卸载程序

### 2. MSI 安装包
- **文件路径**: `token-chat/src-tauri/target/release/bundle/msi/Token Chat_0.5.8_x64_en-US.msi`
- **文件大小**: 4,870,144 字节 (约 4.64 MB)
- **特点**:
  - 标准 Windows Installer 格式
  - 支持组策略部署
  - 支持静默安装
  - 适合企业环境批量部署
  - 支持标准的 MSI 安装参数

## 安装包使用说明

### NSIS 安装包使用

#### 图形界面安装
1. 双击 `Token Chat_0.5.8_x64-setup.exe`
2. 选择安装语言 (中文或英文)
3. 选择安装模式 (当前用户或所有用户)
4. 选择安装路径
5. 完成安装

#### 命令行静默安装
```bash
# 静默安装
Token Chat_0.5.8_x64-setup.exe /S

# 指定安装路径
Token Chat_0.5.8_x64-setup.exe /S /D=C:\Program Files\Token Chat
```

### MSI 安装包使用

#### 图形界面安装
1. 双击 `Token Chat_0.5.8_x64_en-US.msi`
2. 按照安装向导完成安装

#### 命令行静默安装
```bash
# 静默安装
msiexec /i "Token Chat_0.5.8_x64_en-US.msi" /quiet

# 带日志的安装
msiexec /i "Token Chat_0.5.8_x64_en-US.msi" /quiet /log install.log

# 卸载
msiexec /x "Token Chat_0.5.8_x64_en-US.msi" /quiet
```

## 构建配置

安装包配置位于 `token-chat/src-tauri/tauri.conf.json` 文件中的 `bundle` 部分。

当前配置:
- 同时构建 NSIS 和 MSI 两种格式
- 支持中英文语言选择
- 包含应用图标 (32x32, 128x128, ICO)

## 注意事项

1. **系统要求**: Windows 10/11 64位系统
2. **依赖项**: 安装包已包含所有必要依赖，无需额外安装
3. **数据存储**: 应用数据存储在用户目录的 `%APPDATA%\Token Chat` 文件夹
4. **更新**: 建议先卸载旧版本再安装新版本

## 文件校验

### NSIS 安装包
- 文件名: `Token Chat_0.5.8_x64-setup.exe`
- 大小: 3,414,739 字节

### MSI 安装包
- 文件名: `Token Chat_0.5.8_x64_en-US.msi`
- 大小: 4,870,144 字节

## 故障排除

### 安装失败
1. 确保有足够的磁盘空间
2. 以管理员权限运行安装程序
3. 检查是否有杀毒软件拦截

### 无法启动应用
1. 检查 Windows 版本是否符合要求
2. 尝试以管理员权限运行
3. 检查防火墙设置

### 数据迁移
从旧版本迁移数据:
1. 备份 `%APPDATA%\Token Chat` 文件夹
2. 安装新版本
3. 恢复备份的数据文件夹