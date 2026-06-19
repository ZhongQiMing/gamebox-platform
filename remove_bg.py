from PIL import Image
import sys

def remove_black_background(input_path, output_path, threshold=40):
    try:
        img = Image.open(input_path).convert("RGBA")
        datas = img.getdata()

        new_data = []
        for item in datas:
            # 亮度计算：R*0.299 + G*0.587 + B*0.114
            brightness = item[0] * 0.299 + item[1] * 0.587 + item[2] * 0.114
            
            if brightness < threshold:
                # 非常黑的像素，完全透明
                new_data.append((0, 0, 0, 0))
            else:
                # 根据亮度调整透明度，让光晕部分半透明
                alpha = int(min(255, max(0, (brightness - threshold) * (255 / (255 - threshold)))))
                
                if item[0] < 50 and item[1] < 50 and item[2] < 50:
                    new_data.append((0, 0, 0, 0))
                else:
                    # 保留原色，但降低RGB的黑色混入，将其转为alpha的透明度
                    new_data.append((item[0], item[1], item[2], alpha))

        img.putdata(new_data)
        img.save(output_path, "PNG")
        print(f"Processed {input_path} -> {output_path}")
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python remove_bg.py <input> <output> [threshold]")
    else:
        thresh = int(sys.argv[3]) if len(sys.argv) > 3 else 40
        remove_black_background(sys.argv[1], sys.argv[2], thresh)
