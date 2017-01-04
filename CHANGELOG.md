## On Hold
### Planned
* [Issue #7](https://github.com/pajoma/vscode-journal/issues/7) - Picklist with display of open tasks
* [Issue #6](https://github.com/pajoma/vscode-journal/issues/6) - Linking journal pages with notes

----

## 0.5 
### Planned
* Interact with markdown file (ctrl+click) to follow internal links, mark checkboxes, etc. 

----

## 0.4.2.1 (Hotfix)
* Fixed a bug in path resolution  
[Attention]: This bug has been in the released version between 12-29-2016 and 01-04-2017. The last bit of the path was ignored. If your base directory has been "/users/a/b/c", new files have been created in "/users/a/b/2017/01", not in "/users/a/b/c/2017/01". Move your files into the correct folder, otherwise you have to merge by hand. 


## 0.4.2

### Fixes
* Updated code due to changes in extension API
* Adressed [Issue #10](https://github.com/pajoma/vscode-journal/issues/10) 
* Adding license information  

----

## 0.4.1

### Fixes
* Refactored code to ease detection of [Issue #9](https://github.com/pajoma/vscode-journal/issues/9) 

----

## 0.4
### Enhancements  
* [Issue #4](https://github.com/pajoma/vscode-journal/issues/4) - New command `journal:open`
* Cleaned up code
* [Issue #3](https://github.com/pajoma/vscode-journal/issues/3) - Enhanced memo command, supporting tasks now

### Fixes
* [Issue #5](https://github.com/pajoma/vscode-journal/issues/5)


----

## 0.3

### Enhancements
- [Issue #1](https://github.com/pajoma/vscode-journal/issues/1) - New command `journal:day` to open a specific day (see Readme)
- Keybindings `ctrl+shift+j` to call this command
- [Issue #2](https://github.com/pajoma/vscode-journal/issues/2) - Update setting tpl, removing the whitespace 