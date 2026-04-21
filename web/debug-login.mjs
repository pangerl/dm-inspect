import { chromium } from 'playwright';

async function debugLogin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    consoleErrors.push(`Page Error: ${error.message}`);
  });

  try {
    console.log('1. Accessing login page...');
    await page.goto('http://192.168.5.151:17000/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('2. Taking screenshot...');
    await page.screenshot({ path: '/Users/lanpang/dm/code/dm-inspect/debug-login.png', fullPage: true });
    console.log('   Screenshot saved to /Users/lanpang/dm/code/dm-inspect/debug-login.png');
    
    console.log('3. Getting page HTML structure...');
    const html = await page.content();
    
    // Find form elements
    const formInfo = await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      const inputs = document.querySelectorAll('input');
      const buttons = document.querySelectorAll('button');
      
      let formDetails = [];
      forms.forEach((form, i) => {
        formDetails.push({
          index: i,
          action: form.action,
          method: form.method,
          id: form.id,
          className: form.className
        });
      });
      
      let inputDetails = [];
      inputs.forEach((input, i) => {
        inputDetails.push({
          index: i,
          name: input.name,
          id: input.id,
          type: input.type,
          className: input.className,
          placeholder: input.placeholder,
          autocomplete: input.autocomplete
        });
      });
      
      let buttonDetails = [];
      buttons.forEach((button, i) => {
        buttonDetails.push({
          index: i,
          text: button.textContent?.trim(),
          type: button.type,
          id: button.id,
          className: button.className
        });
      });
      
      return { forms: formDetails, inputs: inputDetails, buttons: buttonDetails };
    });
    
    console.log('\n=== LOGIN FORM STRUCTURE ===');
    console.log('Forms:', JSON.stringify(formInfo.forms, null, 2));
    console.log('\nInputs:', JSON.stringify(formInfo.inputs, null, 2));
    console.log('\nButtons:', JSON.stringify(formInfo.buttons, null, 2));
    
    // Try to fill credentials
    console.log('\n4. Attempting to fill credentials...');
    
    // Try common input names for username
    const usernameSelectors = ['input[name="username"]', 'input[name="user"]', 'input[id="username"]', 'input[id="user"]', 'input[type="text"]', 'input[name="email"]'];
    const passwordSelectors = ['input[name="password"]', 'input[id="password"]', 'input[type="password"]'];
    
    let usernameFilled = false;
    let passwordFilled = false;
    
    for (const selector of usernameSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.fill('root');
          console.log(`   Filled username with selector: ${selector}`);
          usernameFilled = true;
          break;
        }
      } catch (e) {}
    }
    
    for (const selector of passwordSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.fill('dm@2025!');
          console.log(`   Filled password with selector: ${selector}`);
          passwordFilled = true;
          break;
        }
      } catch (e) {}
    }
    
    if (usernameFilled && passwordFilled) {
      // Take another screenshot after filling
      await page.screenshot({ path: '/Users/lanpang/dm/code/dm-inspect/debug-login-filled.png', fullPage: true });
      console.log('   Screenshot with credentials saved');
      
      // Try to find and click submit button
      const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("登录")', 'button:has-text("Login")', 'button:has-text("Sign")'];
      for (const selector of submitSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            console.log(`   Found submit button: ${selector}`);
            break;
          }
        } catch (e) {}
      }
    }
    
    console.log('\n5. Console errors:', consoleErrors.length > 0 ? consoleErrors : 'None');
    
    // Show page title and URL
    console.log('\n=== PAGE INFO ===');
    console.log('URL:', page.url());
    console.log('Title:', await page.title());
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

debugLogin();
