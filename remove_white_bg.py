from PIL import Image
import sys

def remove_white_bg(input_path, output_path, tolerance=40):
    try:
        img = Image.open(input_path).convert("RGBA")
        datas = img.getdata()
        
        # Get background color from top-left corner
        bg_color = img.getpixel((0, 0))
        
        new_data = []
        for item in datas:
            # Calculate distance from background color
            dist = sum(abs(item[i] - bg_color[i]) for i in range(3))
            
            if dist < tolerance * 3:
                # Same as background -> fully transparent
                new_data.append((0, 0, 0, 0))
            else:
                # Keep original color
                new_data.append(item)

        img.putdata(new_data)
        img.save(output_path, "PNG")
        print(f"Processed {input_path} -> {output_path}")
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

if __name__ == "__main__":
    remove_white_bg(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 40)
