use windows::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS,
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};
use windows::core::PWSTR;

const TARGET_PREFIX: &str = "TokenChat_Provider_";

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn store_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let target = to_wide(&format!("{}{}", TARGET_PREFIX, provider_id));
    let user_name = to_wide("tokenchat");
    let secret: Vec<u16> = api_key.encode_utf16().chain(std::iter::once(0)).collect();

    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_ptr() as *mut _),
        Comment: PWSTR::null(),
        LastWritten: Default::default(),
        CredentialBlobSize: (secret.len() * 2) as u32,
        CredentialBlob: secret.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: PWSTR::null(),
        UserName: PWSTR(user_name.as_ptr() as *mut _),
    };

    unsafe { CredWriteW(&cred, 0).map_err(|e| format!("CredWrite failed: {}", e)) }
}

pub fn get_api_key(provider_id: &str) -> Result<Option<String>, String> {
    let target = to_wide(&format!("{}{}", TARGET_PREFIX, provider_id));
    let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();

    match unsafe { CredReadW(PWSTR(target.as_ptr() as *mut _), CRED_TYPE_GENERIC, 0, &mut pcred) } {
        Ok(()) => {}
        Err(_) => return Ok(None), // credential not found
    }

    let cred = unsafe { &*pcred };
    let key = if cred.CredentialBlobSize > 0 && !cred.CredentialBlob.is_null() {
        let len = cred.CredentialBlobSize as usize / 2;
        let slice = unsafe { std::slice::from_raw_parts(cred.CredentialBlob as *const u16, len) };
        String::from_utf16_lossy(slice)
    } else {
        String::new()
    };

    unsafe { CredFree(pcred as *const _) };
    Ok(Some(key))
}

pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
    let target = to_wide(&format!("{}{}", TARGET_PREFIX, provider_id));
    unsafe { CredDeleteW(PWSTR(target.as_ptr() as *mut _), CRED_TYPE_GENERIC, 0) }
        .map_err(|e| format!("CredDelete failed: {}", e))
}
