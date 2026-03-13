const fs = require('fs');
const file = '/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber/src/app/(tablet)/checkin/page.tsx';
let content = fs.readFileSync(file, 'utf8');

const newBackButtonStr = `  const getBackAction = () => {
    switch (step) {
      case 'face_scan':
      case 'staff_face_scan':
        return () => goTo('home')
      case 'phone':
        return () => { setPhone(''); goTo('home') }
      case 'name':
        return () => { setPhone(''); setName(''); setIsReturning(false); goTo('phone') }
      case 'service_selection':
        return () => {
          if (!isReturning && !hasExistingFace) goTo('face_enroll')
          else goTo('name')
        }
      case 'barber':
        return () => goTo('service_selection')
      case 'face_enroll':
        return () => goTo('name')
      case 'success':
        if (changingBarberInSuccess) {
          return () => {
            setChangingBarberInSuccess(false)
            resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
          }
        }
        return null
      case 'staff_pin':
        return () => {
          setStaffPinSelected(null)
          setStaffPinValue('')
          setStaffPinError('')
          goTo('staff_face_scan')
        }
      case 'staff_face_enroll':
        return () => goTo('staff_pin')
      case 'manage_turn':
        return reset
      default:
        return null
    }
  }

  const handleBack = getBackAction()

  const backButton = handleBack ? (
    <button
      onClick={handleBack}
      className="fixed top-3 left-3 md:top-6 md:left-6 z-50 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 backdrop-blur-sm"
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm md:text-base">Atrás</span>
    </button>
  ) : null`;

const oldBackButtonRegex = /const backButton = \(onBack: \(\) => void\) => \([\s\S]*?<\/button>\n  \)/;
content = content.replace(oldBackButtonRegex, newBackButtonStr);

function removeBackButtonCalls(str) {
  let idx = 0;
  // Make sure not to match the definition `const backButton =`
  // since the calls look like `{backButton(...)`
  while ((idx = str.indexOf('{backButton', idx)) !== -1) {
    let openCount = 0;
    let startIdx = idx;
    let matchEnd = -1;
    for (let i = idx; i < str.length; i++) {
      if (str[i] === '{') openCount++;
      else if (str[i] === '}') {
        openCount--;
        if (openCount === 0) {
          matchEnd = i;
          break;
        }
      }
    }
    if (matchEnd !== -1) {
      let lineStart = startIdx;
      while (lineStart > 0 && (str[lineStart - 1] === ' ' || str[lineStart - 1] === '\t')) {
        lineStart--;
      }
      str = str.slice(0, lineStart) + str.slice(matchEnd + 1);
      if (str[lineStart] === '\n') {
         str = str.slice(0, lineStart) + str.slice(lineStart + 1);
      } else if (str.slice(lineStart, lineStart+2) === '\r\n') {
         str = str.slice(0, lineStart) + str.slice(lineStart + 2);
      }
      idx = lineStart;
    } else {
      idx += 11;
    }
  }
  return str;
}

content = removeBackButtonCalls(content);

const outerDivStr = `<div className="h-dvh flex flex-col items-center select-none overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)] py-3 md:py-4">`;
content = content.replace(outerDivStr, outerDivStr + `\n      {backButton}`);

fs.writeFileSync(file, content, 'utf8');
console.log("Done");
