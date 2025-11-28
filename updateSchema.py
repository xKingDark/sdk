import os
import requests
import subprocess

def main():
    options = ["LUT", "Go"]
    
    dir = input("Enter the directory: ")

    print("Pick a schema:")
    for i, lang in enumerate(options, start=1):
        print(f"{i}. {lang}")
    
    choice = input("Enter the number of your choice: ")
    
    # Validate input
    if not choice.isdigit() or not (1 <= int(choice) <= len(options)):
        print("Invalid choice. Please run the program again and choose a valid number.")
        return
    
    selected = options[int(choice) - 1]
    if selected == options[0]:
        getLut(dir, ".ts", "https://raw.githubusercontent.com/ExplosionHm/schemas-opticode/main/lut.fbs")
    elif selected == options[1]:
        getGo(dir, ".ts", "https://raw.githubusercontent.com/ExplosionHm/schemas-opticode/main/go.fbs")

def getGo(directory: str, fileSuffix: str, url: str):
    # Delete old files with suffix
    for filename in os.listdir(os.path.join(directory, "tree")):
        if filename.endswith(fileSuffix):
            file_path = os.path.join(directory, "tree", filename)
            try:
                os.remove(file_path)
                print(f"Deleted: {file_path}")
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")

    # Fetch file from GitHub
    try:
        response = requests.get(url)
        response.raise_for_status()
        filename = os.path.basename(url)
        filepath = os.path.join(directory, filename)
        with open(filepath, "wb") as f:
            f.write(response.content)
        print(f"Downloaded: {filename}")
    except Exception as e:
        print(f"Error downloading file: {e}")
        return

    # Run flatc with output to schema directory
    try:
        result = subprocess.run(
            ["flatc", "--ts", "-o", directory, filepath],
            capture_output=True,
            text=True,
            check=False
        )
        print("Command output:\n", result.stdout)
        if result.stderr:
            print("Command error:\n", result.stderr)
    except Exception as e:
        print(f"Error running flatc: {e}")

def getLut(directory: str, fileSuffix: str, url: str):
    # Delete old files with suffix
    for filename in os.listdir(os.path.join(directory, "lut")):
        if filename.endswith(fileSuffix):
            file_path = os.path.join(directory, "lut", filename)
            try:
                os.remove(file_path)
                print(f"Deleted: {file_path}")
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")

    # Fetch file from GitHub
    try:
        response = requests.get(url)
        response.raise_for_status()
        filename = os.path.basename(url)
        filepath = os.path.join(directory, filename)
        with open(filepath, "wb") as f:
            f.write(response.content)
        print(f"Downloaded: {filename}")
    except Exception as e:
        print(f"Error downloading file: {e}")
        return

    # Run flatc with output to schema directory
    try:
        result = subprocess.run(
            ["flatc", "--ts", "-o", directory, filepath],
            capture_output=True,
            text=True,
            check=False
        )
        print("Command output:\n", result.stdout)
        if result.stderr:
            print("Command error:\n", result.stderr)
    except Exception as e:
        print(f"Error running flatc: {e}")
    return

if __name__ == "__main__":
    main()
