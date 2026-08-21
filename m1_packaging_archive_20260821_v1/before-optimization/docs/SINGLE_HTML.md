# 单文件 Web 构建

`build/web-mobile/pindou-single.html` 是由当前 `build/web-mobile` 生成的独立 HTML。它把 71 个运行时文件逐文件 gzip + Base64 内嵌，启动时在浏览器内存中恢复 Blob URL，并为 Cocos 的 SystemJS、XHR、fetch、图片和音频请求提供虚拟文件映射。

## 重新生成

```text
npm run package:single-html
```

打包命令会先运行 M1.9B 来源与资源门禁，然后生成文件并执行逐字节还原校验。输出固定为 `build/web-mobile/pindou-single.html`；它不会读取比较项目或任何外部 bundle。

## 使用

使用最新版 Chrome、Edge、Firefox 或 Safari 双击打开 HTML，或把它放在任意静态服务器下访问。运行时需要浏览器支持 `DecompressionStream('gzip')`；不需要安装 Node、Cocos Creator 或启动游戏服务器。

当前构建约 7.51 MiB，压缩后的单文件约 3.60 MiB。单文件中的引擎、关卡、UI、音频、WASM 和原创美术资源都来自本项目的 Web Mobile 构建。
