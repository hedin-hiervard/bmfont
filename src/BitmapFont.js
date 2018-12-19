// @flow
import fs from 'fs-extra'
import Jimp from 'jimp'
import path from 'path'
import SpritesheetGenerator from 'spritesheet-creator'
import _ from 'lodash'

import type { Logger } from 'ual'

type Char = {
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
    xoffset: number,
    yoffset: number,
    xadvance: number,
    page: number,
    chnl: number,
    letter: string,
    image: *,
};

type Info = {
    face: string,
    size: number,
    bold: boolean,
    italic: boolean,
    charset: string,
    unicode: boolean,
    stretchH: number,
    smooth: boolean,
    aa: boolean,
    padding: [ number, number, number, number ],
    spacing: [ number, number ],
};

type Common = {
    lineHeight: number,
    base: number,
    scaleW: number,
    scaleH: number,
    packed: boolean,
};

type Page = {
    id: number,
    file: string,
    chars: Array<Char>,
    texture: *,
};

function ensureArray4(arr: Array<number>): [ number, number, number, number ] {
    while(arr.length < 4) {
        arr.push(0)
    }
    return [ arr[0], arr[1], arr[2], arr[3] ]
}

function ensureArray2(arr: Array<number>): [ number, number ] {
    while(arr.length < 2) {
        arr.push(0)
    }
    return [ arr[0], arr[1] ]
}

function parseBool(str: string): boolean {
    return str === '1'
}

export default class BitmapFont {
    info: ?Info;
    common: ?Common;
    pages: Array<Page>;
    log: Logger;

    constructor({ log }: {
        log: Logger,
    }) {
        this.log = log
    }
    packString(obj: {}, cmd: string): string {
        const tokens = []
        for(const key of _.keys(obj)) {
            let value = obj[key]
            if(typeof value === 'number') {
                value = value.toString()
            } else if(typeof value === 'string') {
                value = `"${value}"`
            } else if(Array.isArray(value)) {
                value = value.join(',')
            } else {
                continue
            }
            tokens.push(`${key}=${value}`)
        }
        return `${cmd} ${tokens.join(' ')}\n`
    }

    enumerateFile(base: string, id: number, total: number): string {
        if(total <= 1) {
            return base
        } else {
            const parsed = path.parse(base)
            return path.format({
                ...parsed,
                name: `${parsed.name}${id}`,
            })
        }
    }

    async save({
        fntFile,
        textureFile,
    }: {
        fntFile: string,
        textureFile: string,
    }) {
        const sg = new SpritesheetGenerator({
            log: this.log,
            exportFormat: 'null',
            outputTexturePath: null,
            outputDataPath: null,
        })
        this.log.info(`saving font to ${fntFile}`)

        const file = await fs.open(fntFile, 'w')

        if(!this.info) {
            throw new Error(`no info for the font`)
        }
        fs.write(file, this.packString(this.info, 'info'))
        if(!this.common) {
            throw new Error(`no common for the font`)
        }
        await fs.write(file, this.packString(this.common, 'common'))
        for(const page of this.pages) {
            const files = page.chars
                .map(char => ({
                    name: char.letter,
                    image: char.image,
                }))

            const result = await sg.generateFromMemory(files)
            for(const file of result) {
                const char = page.chars.find(char => char.letter === file.name)
                if(!char) {
                    throw new Error(`char "${file.name}" not found in the original font`)
                }
                char.x = file.real.x
                char.y = file.real.y
                char.width = file.real.width
                char.height = file.real.height
            }
            const fullTexturePath = this.enumerateFile(textureFile, page.id, this.pages.length)
            const relPath = path.relative(path.parse(fntFile).dir, fullTexturePath)
            page.file = relPath

            await fs.write(file, `page id=${page.id} file="${page.file}"\n`)
            await fs.write(file, `chars count=${page.chars.length}\n`)
            for(const char of page.chars) {
                await fs.write(file, this.packString(char, 'char'))
            }
            this.log.info(`saving page ${page.id} texture to ${fullTexturePath} (referenced as ${relPath})`)
            await sg.texture.write(textureFile)
        }
        await fs.close(file)
    }

    cutTexture() {
        for(const page of this.pages) {
            if(!page.texture) {
                throw new Error(`no texture loaded`)
            }
            for(const char of page.chars) {
                char.image = page.texture.clone()
                char.image.crop(char.x, char.y, char.width, char.height)
            }
        }
    }

    parseLine(line: string): {
        cmd: string,
        dict: Array<{
            key: string,
            value: string,
        }>
    } {
        const tokens = line.split(/ +/)
        const cmd = tokens.shift()
        const dict = []
        for(const token of tokens) {
            let [ key, value ] = token.split(/=(.+)/)
            const match = value.match(/^"(.*)"$/)
            if(match) {
                value = match[1]
            }
            dict.push({ key, value })
        }

        return { cmd, dict }
    }

    async loadFromFile(filename: string): Promise<void> {
        this.info = null
        this.common = null
        this.pages = []

        this.log.info(`loading from ${filename}`)

        const lines = (await fs.readFile(filename, 'utf-8')).split('\n')

        let curPage

        for(const line of lines) {
            const { cmd, dict } = this.parseLine(line)

            if(cmd === 'info') {
                if(this.info) {
                    throw new Error(`error reading ${filename}: second info command`)
                }
                const info = {
                    face: '',
                    size: 1,
                    stretchH: 1,
                    charset: '',
                    bold: false,
                    italic: false,
                    aa: false,
                    unicode: false,
                    smooth: false,
                    padding: [ 0, 0, 0, 0 ],
                    spacing: [ 0, 0 ],
                }
                for(const { key, value } of dict) {
                    switch(key) {
                    case 'face': info.face = value; break
                    case 'size': info.size = parseInt(value); break
                    case 'stretchH': info.stretchH = parseInt(value); break
                    case 'charset': info.charset = value; break
                    case 'bold': info.bold = parseBool(value); break
                    case 'italic': info.italic = parseBool(value); break
                    case 'aa': info.aa = parseBool(value); break
                    case 'unicode': info.unicode = parseBool(value); break
                    case 'smooth': info.smooth = parseBool(value); break
                    case 'padding': info.padding = ensureArray4(value.split(',').map(v => parseInt(v))); break
                    case 'spacing': info.spacing = ensureArray2(value.split(',').map(v => parseInt(v))); break
                    default:
                        this.log.warn(`unknown info command key: ${key}`)
                        break
                    }
                }
                this.info = info
            } else if(cmd === 'common') {
                if(this.common) {
                    throw new Error(`error reading ${filename} file: second common command`)
                }
                const common = {
                    lineHeight: 1,
                    base: 1,
                    scaleW: 1,
                    scaleH: 1,
                    packed: false,
                }
                for(const { key, value } of dict) {
                    switch(key) {
                    case 'lineHeight': common.lineHeight = parseInt(value); break
                    case 'pages': /* do nothing */ break
                    case 'base': common.base = parseInt(value); break
                    case 'scaleW': common.scaleW = parseInt(value); break
                    case 'scaleH': common.scaleH = parseInt(value); break
                    case 'packed': common.packed = parseBool(value); break
                    default:
                        this.log.warn(`${filename}: unknown common command key: ${key}`)
                        break
                    }
                }
                this.common = common
            } else if(cmd === 'page') {
                curPage = {
                    id: 0,
                    chars: [],
                    file: '',
                    texture: null,
                }
                for(const { key, value } of dict) {
                    switch(key) {
                    case 'id': curPage.id = parseInt(value); break
                    case 'file':
                    {
                        curPage.file = value
                        const textureFullPath = path.join(path.parse(filename).dir, curPage.file)
                        this.log.info(`loading texture from ${textureFullPath}`)
                        curPage.texture = await Jimp.create(textureFullPath)
                        this.log.info(`loaded texture: ${curPage.texture.bitmap.width} x ${curPage.texture.bitmap.height}`)
                        break
                    }
                    default:
                        this.log.warn(`${filename}: unknown page command key: ${key}`)
                        break
                    }
                }
                this.pages.push(curPage)
            } else if(cmd === 'chars') {
                /* do nothing */
            } else if(cmd === 'char') {
                if(this.pages.length === 0) {
                    throw new Error(`${filename}: trying to add char without page`)
                }
                const char = {
                    id: 0,
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    xoffset: 0,
                    yoffset: 0,
                    xadvance: 0,
                    page: this.pages.length - 1,
                    chnl: 0,
                    letter: '',
                    image: null,
                }
                for(const { key, value } of dict) {
                    switch(key) {
                    case 'id': char.id = parseInt(value); break
                    case 'x': char.x = parseInt(value); break
                    case 'y': char.y = parseInt(value); break
                    case 'width': char.width = parseInt(value); break
                    case 'height': char.height = parseInt(value); break
                    case 'xoffset': char.xoffset = parseInt(value); break
                    case 'yoffset': char.yoffset = parseInt(value); break
                    case 'xadvance': char.xadvance = parseInt(value); break
                    case 'page': char.page = parseInt(value); break
                    case 'chnl': char.chnl = parseInt(value); break
                    case 'letter': char.letter = value; break
                    default:
                        this.log.warn(`${filename}: unknown char command key: ${key}`)
                        break
                    }
                }
                this.pages[this.pages.length - 1].chars.push(char)
            }
        }
        await this.cutTexture()
        this.log.info(`${filename}: ${this.pages.reduce((acc, page) => acc + page.chars.length, 0)} chars loaded`)
    }
}
