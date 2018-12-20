import BitmapFont from 'BitmapFont'
import { StreamLogger } from 'ual'
import Jimp from 'jimp'

(async function() {
    const log = new StreamLogger({
        stream: process.stdout,
        colors: true,
    })
    log.debug(process.argv)
    const bmf = new BitmapFont({ log })

    await bmf.loadFromFile(process.argv[2])
    const rendered = bmf.prerenderString(process.argv[4])
    const image = await Jimp.create(rendered.size.width, rendered.size.height, 0x0)
    for(const char of rendered.chars) {
        image.blit(char.image, char.position.x, char.position.y)
    }
    for(let x = 0; x < image.bitmap.width; x++) {
        for(let y = 0; y < image.bitmap.height; y++) {
            let clr = image.getPixelColor(x, y)
            if(clr === 0x0) continue
            clr = 0x000000ff
            image.setPixelColor(clr, x, y)
        }
    }
    await image.write(process.argv[3])

    await bmf.save({
        fntFile: `/Users/hedin/test.fnt`,
        textureFile: `/Users/hedin/test.png`,
    })
})()
