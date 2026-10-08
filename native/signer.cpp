// Coinbase supplies the MPC implementation; this file is a process adapter.
#include <cbmpc/api/ecdsa_mp.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <unistd.h>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
using namespace coinbase;
using namespace coinbase::api;
namespace {
constexpr size_t max_bytes = 4 * 1024 * 1024;
std::string hex(mem_t b) {
  static const char* digits = "0123456789abcdef";
  std::string s; s.reserve(b.size * 2);
  for (int i=0;i<b.size;i++) { s += digits[b.data[i] >> 4]; s += digits[b.data[i] & 15]; }
  return s;
}
buf_t unhex(const std::string& s) {
  if (s.size() > max_bytes * 2 || s.size()%2) throw std::runtime_error("hex bound");
  buf_t b(s.size()/2);
  auto nibble=[](char c)->int { if(c>='0'&&c<='9')return c-'0'; if(c>='a'&&c<='f')return c-'a'+10; throw std::runtime_error("hex"); };
  for(int i=0;i<b.size();i++) b[i]=(nibble(s[i*2])<<4)|nibble(s[i*2+1]);
  return b;
}
std::string line() {
  std::string s;
  for(char c; std::cin.get(c);) { if(c=='\n')return s; if(s.size()>=max_bytes*2)throw std::runtime_error("input bound"); s+=c; }
  throw std::runtime_error("closed transport");
}
class PipeTransport final: public data_transport_i {
 public:
  error_t send(party_idx_t receiver, mem_t msg) override {
    if(msg.size>int(max_bytes))return E_RANGE;
    std::cout << "SEND " << receiver << ' ' << hex(msg) << std::endl;
    return line()=="ACK" ? SUCCESS : E_NET_GENERAL;
  }
  error_t receive(party_idx_t sender, buf_t& msg) override {
    std::cout << "RECV " << sender << std::endl;
    auto s=line(); if(s=="ERROR")return E_NET_GENERAL;
    msg=unhex(s); return SUCCESS;
  }
  error_t receive_all(const std::vector<party_idx_t>& senders,std::vector<buf_t>& msgs) override {
    msgs.resize(senders.size());
    for(size_t i=0;i<senders.size();i++) { auto rv=receive(senders[i],msgs[i]); if(rv)return rv; }
    return SUCCESS;
  }
};
buf_t read_private(const std::string& path) {
  int fd=open(path.c_str(),O_RDONLY|O_NOFOLLOW);
  struct stat st{};
  if(fd<0 || fstat(fd,&st) || !S_ISREG(st.st_mode) || (st.st_mode & 077) || st.st_size>int(max_bytes)) {
    if(fd>=0)close(fd); throw std::runtime_error("private storage permissions");
  }
  buf_t out(st.st_size); size_t off=0;
  while(off<size_t(out.size())) { auto n=read(fd,out.data()+off,out.size()-off); if(n<=0){close(fd);throw std::runtime_error("read");} off+=n; }
  close(fd); return out;
}
// AES-GCM wrapping key is local development material; no claim of HSM isolation.
buf_t crypt(bool encrypt, mem_t input, mem_t wrapping, const std::string& aad) {
  if(wrapping.size!=32)throw std::runtime_error("wrapping length");
  auto ctx=EVP_CIPHER_CTX_new(); if(!ctx)throw std::runtime_error("context");
  std::unique_ptr<EVP_CIPHER_CTX,decltype(&EVP_CIPHER_CTX_free)> guard(ctx,EVP_CIPHER_CTX_free);
  unsigned char iv[12], tag[16]; int n=0,total=0;
  if(encrypt) { if(RAND_bytes(iv,12)!=1)throw std::runtime_error("random"); }
  else { if(input.size<28)throw std::runtime_error("envelope"); memcpy(iv,input.data,12); memcpy(tag,input.data+input.size-16,16); }
  if(EVP_CipherInit_ex(ctx,EVP_aes_256_gcm(),nullptr,wrapping.data,iv,encrypt)!=1)throw std::runtime_error("init");
  if(EVP_CipherUpdate(ctx,nullptr,&n,reinterpret_cast<const unsigned char*>(aad.data()),aad.size())!=1)throw std::runtime_error("aad");
  buf_t out(encrypt?input.size+28:input.size-28); int offset=encrypt?12:0;
  auto data=encrypt?input.data:input.data+12; int len=encrypt?input.size:input.size-28;
  if(encrypt)memcpy(out.data(),iv,12);
  if(EVP_CipherUpdate(ctx,out.data()+offset,&n,data,len)!=1)throw std::runtime_error("cipher"); total=n;
  if(!encrypt && EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_TAG,16,tag)!=1)throw std::runtime_error("tag");
  if(EVP_CipherFinal_ex(ctx,out.data()+offset+total,&n)!=1)throw std::runtime_error("integrity");
  if(encrypt) { if(EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_GET_TAG,16,tag)!=1)throw std::runtime_error("tag"); memcpy(out.data()+12+len,tag,16); }
  return out;
}
void store(const std::string& path, mem_t data) {
  int fd=open(path.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
  if(fd<0)throw std::runtime_error("storage exists");
  size_t off=0;
  while(off<size_t(data.size)) { auto n=write(fd,data.data+off,data.size-off); if(n<=0){close(fd);throw std::runtime_error("write");} off+=n; }
  if(fsync(fd)){close(fd);throw std::runtime_error("fsync");} close(fd);
}
}
int main(int argc,char** argv) {
  struct rlimit limit{0,0}; setrlimit(RLIMIT_CORE,&limit); umask(0077);
  // Never emit upstream diagnostic strings: only status codes and public outputs.
  coinbase::out_log_fun=[](int,const char*){};
  try {
    if(argc!=9)throw std::runtime_error("arguments");
    std::string mode=argv[1], identity=argv[2], path=argv[4], aad="quorum/ecdsa-mp/secp256k1/v2/"+identity+"/"+argv[6];
    std::vector<std::string> names; std::stringstream parts(argv[3]);
    for(std::string name;std::getline(parts,name,',');)names.push_back(name);
    std::vector<std::string_view> views; int self=-1;
    for(size_t i=0;i<names.size();i++) { views.push_back(names[i]); if(names[i]==identity)self=i; }
    std::vector<std::string> all_names; std::stringstream all_parts(argv[8]);
    for(std::string name;std::getline(all_parts,name,',');)all_names.push_back(name);
    if(all_names.size()!=3)throw std::runtime_error("identity set");
    auto ac=access_structure_t::Threshold(2,{access_structure_t::leaf(all_names[0]),access_structure_t::leaf(all_names[1]),access_structure_t::leaf(all_names[2])});
    PipeTransport transport; job_mp_t job{self,views,transport}; buf_t key,sid,signature; error_t rv;
    auto wrapping=read_private(argv[5]);
    if(mode=="dkg") {
      std::vector<std::string_view> contributors={all_names[0],all_names[1]};
      rv=ecdsa_mp::dkg_ac(job,curve_id::secp256k1,sid,ac,contributors,key);
      if(rv) { std::cout<<"FAIL "<<rv<<std::endl; return 1; }
      auto encrypted=crypt(true,key,wrapping,aad); store(path,encrypted);
    } else if(mode=="sign") {
      auto encrypted=read_private(path); key=crypt(false,encrypted,wrapping,aad);
      auto hash=unhex(argv[7]); if(hash.size()!=32)throw std::runtime_error("digest length");
      rv=ecdsa_mp::sign_ac(job,key,ac,hash,0,signature);
      if(rv) { std::cout<<"FAIL "<<rv<<std::endl; return 1; }
    } else throw std::runtime_error("mode");
    buf_t pub; rv=ecdsa_mp::get_public_key_compressed(key,pub);
    if(rv)return 1;
    std::cout << "DONE " << hex(pub) << ' ' << hex(signature) << std::endl;
    return 0;
  } catch(...) { std::cout<<"FAIL adapter"<<std::endl; return 1; }
}
